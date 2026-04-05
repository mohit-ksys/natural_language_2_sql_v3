export const getLeadAttemptTimeReport = async (req, res) => {
  try {
    const { date_start, date_end, source, group_by = "counsellor" } = req.query;
    const userRole = req.user?.role; // Get user role from request
    const isAnalyser = userRole === "Analyser";
    // Convert dates to IST timezone consistently
    const getISTDate = (dateString, time) => {
      const date = new Date(`${dateString}T${time}+05:30`); // IST offset
      return date.toISOString(); // Convert to UTC ISO string
    };

    let whereConditions = [];
    let queryParams = {};

    // Add Facebook filter for analysers regardless of source parameter
    if (isAnalyser) {
      whereConditions.push(`s.source = 'FaceBook'`);
    } else if (source) {
      // For non-analysers, use the source from query parameter
      whereConditions.push(`s.source = $source`);
      queryParams.source = source;
    }

    if (date_start) {
      whereConditions.push(`s.created_at >= $date_start`);
      queryParams.date_start = getISTDate(date_start, "00:00:00");
    }
    if (date_end) {
      whereConditions.push(`s.created_at <= $date_end`);
      queryParams.date_end = getISTDate(date_end, "23:59:59");
    }

    let groupByField, groupByName;
    if (group_by === "hour") {
      groupByField = `EXTRACT(HOUR FROM s.created_at AT TIME ZONE 'Asia/Kolkata')`;
      groupByName = `
        CASE 
          WHEN EXTRACT(HOUR FROM s.created_at AT TIME ZONE 'Asia/Kolkata') < 9 THEN 'Till 9 AM'
          WHEN EXTRACT(HOUR FROM s.created_at AT TIME ZONE 'Asia/Kolkata') = 9 THEN '9:00 - 10:00'
          WHEN EXTRACT(HOUR FROM s.created_at AT TIME ZONE 'Asia/Kolkata') = 10 THEN '10:00 - 11:00'
          WHEN EXTRACT(HOUR FROM s.created_at AT TIME ZONE 'Asia/Kolkata') = 11 THEN '11:00 - 12:00'
          WHEN EXTRACT(HOUR FROM s.created_at AT TIME ZONE 'Asia/Kolkata') = 12 THEN '12:00 - 13:00'
          WHEN EXTRACT(HOUR FROM s.created_at AT TIME ZONE 'Asia/Kolkata') = 13 THEN '13:00 - 14:00'
          WHEN EXTRACT(HOUR FROM s.created_at AT TIME ZONE 'Asia/Kolkata') = 14 THEN '14:00 - 15:00'
          WHEN EXTRACT(HOUR FROM s.created_at AT TIME ZONE 'Asia/Kolkata') = 15 THEN '15:00 - 16:00'
          WHEN EXTRACT(HOUR FROM s.created_at AT TIME ZONE 'Asia/Kolkata') = 16 THEN '16:00 - 17:00'
          WHEN EXTRACT(HOUR FROM s.created_at AT TIME ZONE 'Asia/Kolkata') = 17 THEN '17:00 - 18:00'
          WHEN EXTRACT(HOUR FROM s.created_at AT TIME ZONE 'Asia/Kolkata') = 18 THEN '18:00 - 19:00'
          WHEN EXTRACT(HOUR FROM s.created_at AT TIME ZONE 'Asia/Kolkata') = 19 THEN '19:00 - 20:00'
          WHEN EXTRACT(HOUR FROM s.created_at AT TIME ZONE 'Asia/Kolkata') = 20 THEN '20:00 - 21:00'
          ELSE 'After 9 PM'
        END
      `;
    } else {
      // Group by counsellor with supervisor information
      groupByField = `COALESCE(c.counsellor_name, 'Unassigned')`;
      groupByName = `
        COALESCE(
          CASE 
            WHEN c.counsellor_name IS NULL THEN 'Unassigned'
            ELSE c.counsellor_name || '|' || COALESCE(sup.counsellor_name, 'No Supervisor')
          END, 
          'Unassigned|No Supervisor'
        )
      `;
    }

    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

    const query = `
      WITH student_first_remark AS (
        SELECT 
          sr.student_id,
          MIN(sr.created_at) as first_remark_time
        FROM student_remarks sr
        ${isAnalyser ? `INNER JOIN students s2 ON sr.student_id = s2.student_id AND s2.source = 'FaceBook'` : ""}
        GROUP BY sr.student_id
      )
      SELECT
        ${groupByName} as group_name,
        ${group_by === "counsellor"
        ? `COALESCE(c.counsellor_name, 'Unassigned') as counsellor_name,
          COALESCE(sup.counsellor_name, 'No Supervisor') as supervisor_name,`
        : ""
      }
        COUNT(DISTINCT s.student_id) as leads_assigned,
        COUNT(DISTINCT sfr.student_id) as attempted,
        COUNT(DISTINCT CASE 
          WHEN EXTRACT(EPOCH FROM (sfr.first_remark_time - s.created_at))/60 <= 15 
          THEN sfr.student_id 
        END) as within_15,
        COUNT(DISTINCT CASE 
          WHEN EXTRACT(EPOCH FROM (sfr.first_remark_time - s.created_at))/60 BETWEEN 16 AND 30 
          THEN sfr.student_id 
        END) as min_15_30,
        COUNT(DISTINCT CASE 
          WHEN EXTRACT(EPOCH FROM (sfr.first_remark_time - s.created_at))/60 > 30 
          THEN sfr.student_id 
        END) as gt_30
      FROM students s
      LEFT JOIN student_first_remark sfr ON s.student_id = sfr.student_id
      LEFT JOIN counsellors c ON s.assigned_counsellor_id = c.counsellor_id
      LEFT JOIN counsellors sup ON c.assigned_to = sup.counsellor_id
      ${whereClause}
      GROUP BY ${groupByName}
      ${group_by === "counsellor" ? ", c.counsellor_name, sup.counsellor_name" : ""}
      ORDER BY 
        CASE 
          WHEN ${groupByName} LIKE '%No Supervisor%' THEN 1
          WHEN ${group_by === "hour"} THEN
            CASE 
              WHEN ${groupByName} = 'Till 9 AM' THEN 1
              WHEN ${groupByName} = '9:00 - 10:00' THEN 2
              WHEN ${groupByName} = '10:00 - 11:00' THEN 3
              WHEN ${groupByName} = '11:00 - 12:00' THEN 4
              WHEN ${groupByName} = '12:00 - 13:00' THEN 5
              WHEN ${groupByName} = '13:00 - 14:00' THEN 6
              WHEN ${groupByName} = '14:00 - 15:00' THEN 7
              WHEN ${groupByName} = '15:00 - 16:00' THEN 8
              WHEN ${groupByName} = '16:00 - 17:00' THEN 9
              WHEN ${groupByName} = '17:00 - 18:00' THEN 10
              WHEN ${groupByName} = '18:00 - 19:00' THEN 11
              WHEN ${groupByName} = '19:00 - 20:00' THEN 12
              WHEN ${groupByName} = '20:00 - 21:00' THEN 13
              WHEN ${groupByName} = 'After 9 PM' THEN 14
              ELSE 15
            END
          ELSE 0
        END,
        ${group_by === "counsellor" ? "sup.counsellor_name, c.counsellor_name" : "group_name"}
    `;

    const results = await sequelize.query(query, {
      type: sequelize.QueryTypes.SELECT,
      bind: queryParams,
    });

    const rows = results.map((row) => {
      const leadsAssigned = Number(row.leads_assigned) || 0;
      const attempted = Number(row.attempted) || 0;
      const within15 = Number(row.within_15) || 0;
      const min1530 = Number(row.min_15_30) || 0;
      const gt30 = Number(row.gt_30) || 0;

      let groupName, counsellorName, supervisorName;

      if (group_by === "hour") {
        groupName = row.group_name;
        counsellorName = null;
        supervisorName = null;
      } else {
        // Parse the combined group_name field
        const parts = row.group_name.split("|");
        if (parts.length === 2) {
          counsellorName = parts[0] === "Unassigned" ? null : parts[0];
          supervisorName = parts[1] === "No Supervisor" ? null : parts[1];
          groupName = counsellorName || "Unassigned";
        } else {
          counsellorName = row.counsellor_name || null;
          supervisorName = row.supervisor_name || null;
          groupName = counsellorName || "Unassigned";
        }
      }

      return {
        groupName,
        counsellorName,
        supervisorName: supervisorName || "No Supervisor",
        leadsAssigned,
        attempted,
        within15,
        min1530,
        gt30,
        percAttempted:
          leadsAssigned > 0
            ? ((attempted / leadsAssigned) * 100).toFixed(0) + "%"
            : "0%",
        perc15:
          leadsAssigned > 0
            ? ((within15 / leadsAssigned) * 100).toFixed(0) + "%"
            : "0%",
        perc30:
          leadsAssigned > 0
            ? ((min1530 / leadsAssigned) * 100).toFixed(0) + "%"
            : "0%",
        percGt30:
          leadsAssigned > 0
            ? ((gt30 / leadsAssigned) * 100).toFixed(0) + "%"
            : "0%",
      };
    });

    // Group by supervisor for hierarchical structure
    const groupedBySupervisor = {};
    rows.forEach((row) => {
      if (group_by !== "hour") {
        const supervisorName = row.supervisorName || "No Supervisor";
        const counsellorName = row.counsellorName || "Unassigned";

        if (!groupedBySupervisor[supervisorName]) {
          groupedBySupervisor[supervisorName] = {
            supervisorName,
            leadsAssigned: 0,
            attempted: 0,
            within15: 0,
            min1530: 0,
            gt30: 0,
            counsellors: [],
          };
        }

        groupedBySupervisor[supervisorName].counsellors.push(row);
        groupedBySupervisor[supervisorName].leadsAssigned += row.leadsAssigned;
        groupedBySupervisor[supervisorName].attempted += row.attempted;
        groupedBySupervisor[supervisorName].within15 += row.within15;
        groupedBySupervisor[supervisorName].min1530 += row.min1530;
        groupedBySupervisor[supervisorName].gt30 += row.gt30;
      }
    });

    // Calculate percentages for supervisor groups
    Object.values(groupedBySupervisor).forEach((supervisorGroup) => {
      const leadsAssigned = supervisorGroup.leadsAssigned;
      supervisorGroup.percAttempted =
        leadsAssigned > 0
          ? ((supervisorGroup.attempted / leadsAssigned) * 100).toFixed(0) + "%"
          : "0%";
      supervisorGroup.perc15 =
        leadsAssigned > 0
          ? ((supervisorGroup.within15 / leadsAssigned) * 100).toFixed(0) + "%"
          : "0%";
      supervisorGroup.perc30 =
        leadsAssigned > 0
          ? ((supervisorGroup.min1530 / leadsAssigned) * 100).toFixed(0) + "%"
          : "0%";
      supervisorGroup.percGt30 =
        leadsAssigned > 0
          ? ((supervisorGroup.gt30 / leadsAssigned) * 100).toFixed(0) + "%"
          : "0%";
    });

    // Convert to array
    const hierarchicalResult = Object.values(groupedBySupervisor)
      .map((supervisorGroup) => ({
        ...supervisorGroup,
        counsellors: supervisorGroup.counsellors.sort((a, b) => {
          if (a.counsellorName === "Unassigned") return 1;
          if (b.counsellorName === "Unassigned") return -1;
          return (a.counsellorName || "").localeCompare(b.counsellorName || "");
        }),
      }))
      .sort((a, b) => a.supervisorName.localeCompare(b.supervisorName));

    // Prepare response
    const response = {
      success: true,
      rows,
      groupedBySupervisor: group_by !== "hour" ? hierarchicalResult : null,
      groupBy: group_by,
      summary: {
        totalLeadsAssigned: rows.reduce(
          (sum, row) => sum + row.leadsAssigned,
          0,
        ),
        totalAttempted: rows.reduce((sum, row) => sum + row.attempted, 0),
        totalSupervisors:
          group_by !== "hour" ? Object.keys(groupedBySupervisor).length : 0,
        totalCounsellors: rows.length,
      },
    };

    // Add note for analysers
    if (isAnalyser) {
      response.summary.note = "Data includes only Facebook leads";
      response.summary.dataFilter = "Facebook leads only";

      // Override any source parameter in the response
      if (source) {
        response.summary.originalSourceParam = source;
        response.summary.note += ` (Original source parameter "${source}" was ignored)`;
      }
    }

    res.json(response);
  } catch (err) {
    console.error("Error in getLeadAttemptTimeReport:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};