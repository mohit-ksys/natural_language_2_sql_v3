export const getTrackerReport2 = async (req, res) => {
  try {
    const { date_start, date_end, groupBy = "slot" } = req.query;
    const userRole = req.user?.role; // Get user role from request
    console.log(userRole);
    if (!date_start || !date_end) {
      return res
        .status(400)
        .json({
          success: false,
          message: "date_start and date_end are required",
        });
    }

    // Use explicit timezone handling (IST = UTC+5:30)
    const startDate = new Date(date_start + "T00:00:00+05:30");
    const endDate = new Date(date_end + "T23:59:59+05:30");

    // Fetch counsellor names and supervisors
    const counsellors = await Counsellor.findAll({
      attributes: ["counsellor_id", "counsellor_name", "assigned_to"],
      raw: true,
    });

    const counsellorMap = {};
    const supervisorMap = {};
    const counsellorSupervisorMap = {}; // Map counsellor_id to supervisor_name

    counsellors.forEach((c) => {
      counsellorMap[c.counsellor_id] = c.counsellor_name;

      // Find supervisor name
      let supervisorName = "No Supervisor";
      if (c.assigned_to) {
        const supervisor = counsellors.find(
          (sup) => sup.counsellor_id === c.assigned_to,
        );
        if (supervisor) {
          supervisorName = supervisor.counsellor_name;
        }
      }

      counsellorSupervisorMap[c.counsellor_id] = supervisorName;

      // Build supervisor map for grouping
      if (!supervisorMap[supervisorName]) {
        supervisorMap[supervisorName] = {
          supervisorName,
          counsellors: [],
        };
      }
    });

    // Variables for Facebook filtering
    let facebookStudentIds = [];
    let isAnalyser = userRole === "Analyser";

    if (isAnalyser) {
      // Get all Facebook student IDs to filter remarks for analysers only
      const facebookStudents = await Student.findAll({
        where: {
          source: "FaceBook", // Filter by Facebook source for analysers
        },
        attributes: ["student_id"],
        raw: true,
      });

      facebookStudentIds = facebookStudents.map((s) => s.student_id);

      if (facebookStudentIds.length === 0) {
        return res.json({
          success: true,
          groupBy,
          rows: [],
          groupedBySupervisor: groupBy === "counsellor" ? [] : null,
          totals: {
            totalUniqueRemarks: {
              count: 0,
              percentage: 0.0,
            },
            firstTimeConnected: {
              count: 0,
              percentage: 0.0,
            },
            firstTimeICC: {
              count: 0,
              percentage: 0.0,
            },
            firstTimeNI: {
              count: 0,
              percentage: 0.0,
            },
          },
          summary: {
            totalSupervisors: 0,
            totalCounsellors: 0,
            note: "No Facebook leads found for the selected date range",
          },
        });
      }
    }

    // Build where conditions for remarks
    const remarkWhereConditions = {
      created_at: { [Op.between]: [startDate, endDate] },
    };

    // Add Facebook filter only for analysers
    if (isAnalyser) {
      remarkWhereConditions.student_id = { [Op.in]: facebookStudentIds };
    }

    // Filter remarks
    const remarks = await StudentRemark.findAll({
      where: remarkWhereConditions,
      attributes: [
        "remark_id",
        "student_id",
        "counsellor_id",
        "calling_status",
        "lead_status",
        "lead_sub_status",
        "created_at",
      ],
      order: [
        ["student_id", "ASC"],
        ["created_at", "ASC"],
      ],
      raw: true,
    });

    // Build SQL queries based on role
    let firstConnectedQuery, firstICCQuery, firstNIQuery;

    if (isAnalyser) {
      // For analysers: filter by Facebook source
      firstConnectedQuery = `
        SELECT DISTINCT ON (sr.student_id)
          sr.student_id,
          sr.created_at as first_connected_at
        FROM student_remarks sr
        INNER JOIN students s ON sr.student_id = s.student_id
        WHERE LOWER(TRIM(sr.calling_status)) = 'connected'
          AND s.source = 'FaceBook'
        ORDER BY sr.student_id, sr.created_at 
      `;

      // Use s."first_Icc_Date" for ICC - this is the date when ICC milestone was achieved
      firstICCQuery = `
        SELECT 
          student_id,
          "first_Icc_Date" as first_icc_at
        FROM students
        WHERE "first_Icc_Date" IS NOT NULL
          AND source = 'FaceBook'
      `;

      firstNIQuery = `
        SELECT DISTINCT ON (sr.student_id)
          sr.student_id,
          sr.created_at as first_ni_at
        FROM student_remarks sr
        INNER JOIN students s ON sr.student_id = s.student_id
        WHERE s.current_student_status = 'NotInterested'
          AND s.source = 'FaceBook'
        ORDER BY sr.student_id, sr.created_at ASC
      `;
    } else {
      // For other roles: get all data
      firstConnectedQuery = `
        SELECT DISTINCT ON (student_id)
          student_id,
          created_at as first_connected_at
        FROM student_remarks
        WHERE LOWER(TRIM(calling_status)) = 'connected'
        ORDER BY student_id, created_at ASC
      `;

      // Use s."first_Icc_Date" for ICC
      firstICCQuery = `
        SELECT 
          student_id,
          "first_Icc_Date" as first_icc_at
        FROM students
        WHERE "first_Icc_Date" IS NOT NULL
      `;

      firstNIQuery = `
        SELECT DISTINCT ON (sr.student_id)
          sr.student_id,
          sr.created_at as first_ni_at
        FROM student_remarks sr
        INNER JOIN students s ON sr.student_id = s.student_id
        WHERE s.current_student_status = 'NotInterested'
        ORDER BY sr.student_id, sr.created_at ASC
      `;
    }

    // Execute queries
    const [firstConnected, firstICC, firstNI, studentsForStatus] = await Promise.all([
      sequelize.query(firstConnectedQuery, { type: sequelize.QueryTypes.SELECT }),
      sequelize.query(firstICCQuery, { type: sequelize.QueryTypes.SELECT }),
      sequelize.query(firstNIQuery, { type: sequelize.QueryTypes.SELECT }),
      Student.findAll({
        attributes: ["student_id", "current_student_status"],
        raw: true,
      }),
    ]);

    const studentStatusMap = {};
    studentsForStatus.forEach((s) => {
      studentStatusMap[s.student_id] = s.current_student_status;
    });

    const firstConnectedMap = {};
    firstConnected.forEach((r) => {
      firstConnectedMap[r.student_id] = new Date(
        r.first_connected_at,
      ).getTime();
    });

    // Create a map of first ICC date per student (from students table)
    const firstICCMap = {};
    firstICC.forEach((r) => {
      firstICCMap[r.student_id] = new Date(r.first_icc_at).getTime();
    });

    const firstNIMap = {};
    firstNI.forEach((r) => {
      firstNIMap[r.student_id] = new Date(r.first_ni_at).getTime();
    });

    // Log for debugging
    console.log(`Total students with ICC: ${Object.keys(firstICCMap).length}`);
    console.log(`Sample ICC students:`, Object.keys(firstICCMap).slice(0, 5));

    const getGroupKey = (remark) => {
      if (groupBy === "counsellor") {
        const counsellorId = remark.counsellor_id || "Unassigned";
        if (counsellorId === "Unassigned") {
          return {
            groupKey: "Unassigned",
            counsellorName: "Unassigned",
            supervisorName: "No Supervisor",
          };
        }

        const counsellorName = counsellorMap[counsellorId] || counsellorId;
        const supervisorName =
          counsellorSupervisorMap[counsellorId] || "No Supervisor";

        return {
          groupKey: counsellorName,
          counsellorName,
          supervisorName,
        };
      } else {
        // Convert UTC time to IST for slot grouping
        const d = new Date(remark.created_at);
        // Add 5 hours 30 minutes for IST
        const istDate = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
        const hour = istDate.getUTCHours();

        if (hour >= 9 && hour < 24) {
          const nextHour =
            hour === 23 ? "00" : (hour + 1).toString().padStart(2, "0");
          const slotKey = `${hour.toString().padStart(2, "0")}:00-${nextHour}:00`;
          return {
            groupKey: slotKey,
            counsellorName: null,
            supervisorName: null,
          };
        }
        return null;
      }
    };

    // Pre-initialize all time slots if groupBy is 'slot'
    const groupData = {};
    if (groupBy === "slot") {
      for (let h = 9; h < 24; h++) {
        const nextHour = h === 23 ? "00" : (h + 1).toString().padStart(2, "0");
        const slotKey = `${h.toString().padStart(2, "0")}:00-${nextHour}:00`;
        groupData[slotKey] = {
          groupKey: slotKey,
          counsellorName: null,
          supervisorName: null,
          totalUniqueRemarks: new Set(),
          firstTimeConnected: new Set(),
          firstTimeICC: new Set(),
          firstTimeNI: new Set(),
        };
      }
    }

    const overallTotals = {
      totalUniqueRemarks: new Set(),
      firstTimeConnected: new Set(),
      firstTimeICC: new Set(),
      firstTimeNI: new Set(),
    };

    // Process each remark
    remarks.forEach((remark) => {
      const groupInfo = getGroupKey(remark);
      if (!groupInfo) return;

      const { groupKey, counsellorName, supervisorName } = groupInfo;

      if (!groupData[groupKey]) {
        groupData[groupKey] = {
          groupKey,
          counsellorName,
          supervisorName,
          totalUniqueRemarks: new Set(),
          firstTimeConnected: new Set(),
          firstTimeICC: new Set(),
          firstTimeNI: new Set(),
        };
      }

      const remarkTime = new Date(remark.created_at).getTime();

      groupData[groupKey].totalUniqueRemarks.add(remark.student_id);
      overallTotals.totalUniqueRemarks.add(remark.student_id);

      // Check for first time connected
      if (
        remark.calling_status &&
        remark.calling_status.toLowerCase().trim() === "connected"
      ) {
        const firstConnTime = firstConnectedMap[remark.student_id];
        if (firstConnTime && remarkTime === firstConnTime) {
          groupData[groupKey].firstTimeConnected.add(remark.student_id);
          overallTotals.firstTimeConnected.add(remark.student_id);
        }
      }

      // Check for first ICC - CHANGED LOGIC
      // Instead of matching remark time with ICC time, we check if the student's ICC milestone
      // falls within the date range, and if so, we add it when we process ANY remark from that student
      const firstICCTime = firstICCMap[remark.student_id];
      if (firstICCTime) {
        // Check if ICC date falls within the selected date range
        const iccDate = new Date(firstICCTime);
        if (iccDate >= startDate && iccDate <= endDate) {
          // Add this student to ICC set for the current group
          groupData[groupKey].firstTimeICC.add(remark.student_id);
          overallTotals.firstTimeICC.add(remark.student_id);
        }
      }

      // Check for first NI
      const currentStatus = studentStatusMap[remark.student_id];
      if (currentStatus === "NotInterested") {
        const firstNITime = firstNIMap[remark.student_id];
        if (firstNITime && remarkTime === firstNITime) {
          groupData[groupKey].firstTimeNI.add(remark.student_id);
          overallTotals.firstTimeNI.add(remark.student_id);
        }
      }
    });

    // Generate rows from groupData
    const rows = Object.keys(groupData).map((key) => ({
      groupKey: groupData[key].groupKey,
      counsellorName: groupData[key].counsellorName,
      supervisorName: groupData[key].supervisorName,
      totalUniqueRemarks: groupData[key].totalUniqueRemarks.size,
      firstTimeConnected: groupData[key].firstTimeConnected.size,
      firstTimeICC: groupData[key].firstTimeICC.size,
      firstTimeNI: groupData[key].firstTimeNI.size,
    }));

    // Sort if groupBy is 'slot'
    if (groupBy === "slot") {
      const slotOrder = [];
      for (let h = 9; h < 24; h++) {
        const nextHour = h === 23 ? "00" : (h + 1).toString().padStart(2, "0");
        slotOrder.push(`${h.toString().padStart(2, "0")}:00-${nextHour}:00`);
      }
      rows.sort(
        (a, b) => slotOrder.indexOf(a.groupKey) - slotOrder.indexOf(b.groupKey),
      );
    }

    // Group by supervisor for counsellor view
    let groupedBySupervisor = null;
    if (groupBy === "counsellor") {
      const supervisorGroups = {};

      rows.forEach((row) => {
        const supervisorName = row.supervisorName || "No Supervisor";

        if (!supervisorGroups[supervisorName]) {
          supervisorGroups[supervisorName] = {
            supervisorName,
            totalUniqueRemarks: 0,
            firstTimeConnected: 0,
            firstTimeICC: 0,
            firstTimeNI: 0,
            counsellors: [],
          };
        }

        supervisorGroups[supervisorName].counsellors.push(row);
        supervisorGroups[supervisorName].totalUniqueRemarks +=
          row.totalUniqueRemarks;
        supervisorGroups[supervisorName].firstTimeConnected +=
          row.firstTimeConnected;
        supervisorGroups[supervisorName].firstTimeICC += row.firstTimeICC;
        supervisorGroups[supervisorName].firstTimeNI += row.firstTimeNI;
      });

      // Convert to array
      groupedBySupervisor = Object.values(supervisorGroups)
        .map((group) => ({
          ...group,
          counsellors: group.counsellors.sort((a, b) => {
            if (a.groupKey === "Unassigned") return 1;
            if (b.groupKey === "Unassigned") return -1;
            return a.groupKey.localeCompare(b.groupKey);
          }),
        }))
        .sort((a, b) => {
          if (a.supervisorName === "No Supervisor") return 1;
          if (b.supervisorName === "No Supervisor") return -1;
          return a.supervisorName.localeCompare(b.supervisorName);
        });
    }

    // Calculate totals
    const totals = {
      totalUniqueRemarks: overallTotals.totalUniqueRemarks.size,
      firstTimeConnected: overallTotals.firstTimeConnected.size,
      firstTimeICC: overallTotals.firstTimeICC.size,
      firstTimeNI: overallTotals.firstTimeNI.size,
    };

    // Calculate percentages
    const totalPercentages = {
      connectedPerc: totals.totalUniqueRemarks
        ? (
          (totals.firstTimeConnected / totals.totalUniqueRemarks) *
          100
        ).toFixed(1)
        : "0.0",
      iccPerc: totals.totalUniqueRemarks
        ? ((totals.firstTimeICC / totals.totalUniqueRemarks) * 100).toFixed(1)
        : "0.0",
      niPerc: totals.totalUniqueRemarks
        ? ((totals.firstTimeNI / totals.totalUniqueRemarks) * 100).toFixed(1)
        : "0.0",
    };

    // Prepare response
    const response = {
      success: true,
      groupBy,
      rows,
      groupedBySupervisor,
      totals: {
        totalUniqueRemarks: {
          count: totals.totalUniqueRemarks,
          percentage: 100.0,
        },
        firstTimeConnected: {
          count: totals.firstTimeConnected,
          percentage: parseFloat(totalPercentages.connectedPerc),
        },
        firstTimeICC: {
          count: totals.firstTimeICC,
          percentage: parseFloat(totalPercentages.iccPerc),
        },
        firstTimeNI: {
          count: totals.firstTimeNI,
          percentage: parseFloat(totalPercentages.niPerc),
        },
      },
      summary: {
        totalSupervisors: groupedBySupervisor ? groupedBySupervisor.length : 0,
        totalCounsellors: rows.length,
      },
    };

    // Add note for analysers
    if (isAnalyser) {
      response.summary.note = "Data includes only Facebook leads";
      response.summary.dataFilter = "Facebook leads only";
    }

    res.json(response);
  } catch (err) {
    console.error("Error in getTrackerReport2:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};