export const getThreeRecordsOfFormFilled = async (req, res) => {
  try {
    const {
      type,
      source,
      utm_campaign,
      created_at_start,
      created_at_end,
      counsellor_id,
      counsellor_status,
      sortBy,
      sortOrder,
    } = req.query;

    const userRole = req.user?.role;
    const userId = req.user?.id;
    const isAnalyser = userRole === "Analyser";

    let analyserFilters = {};
    if (isAnalyser && userId) {
      try {
        const analyser = await Analyser.findByPk(userId, {
          attributes: [
            "sources",
            "campaigns",
            "student_creation_date",
            "source_urls",
          ],
        });

        if (analyser) {
          analyserFilters = {
            sources: analyser.sources || [],
            campaigns: analyser.campaigns || [],
            student_creation_date: analyser.student_creation_date || "",
            source_urls: analyser.source_urls || [],
          };
        }
      } catch (error) {
        console.error("Error fetching analyser data:", error);
      }
    }

    const utm_array = utm_campaign && utm_campaign.split(",");
    const counsellor_array = counsellor_id && counsellor_id.split(",");
    const source_array = source && source.split(",");

    if (
      !["agent", "source", "campaign", "created_at", "source_url"].includes(
        type,
      )
    ) {
      return res
        .status(400)
        .json({
          error:
            "Invalid type. Use agent, source, campaign, created_at, or source_url",
        });
    }

    const dateRangeSQL = (col, start, end) => {
      if (start && end) {
        const startUTC = new Date(`${start}T00:00:00+05:30`).toISOString();
        const endDate = new Date(`${end}T23:59:59+05:30`);
        const endUTC = endDate.toISOString();
        return `${col} >= '${startUTC}' AND ${col} <= '${endUTC}'`;
      }
      if (start) {
        const startUTC = new Date(`${start}T00:00:00+05:30`).toISOString();
        return `${col} >= '${startUTC}'`;
      }
      if (end) {
        const endDate = new Date(`${end}T23:59:59+05:30`);
        const endUTC = endDate.toISOString();
        return `${col} <= '${endUTC}'`;
      }
      return "";
    };

    const applyAnalyserDateFilter = () => {
      if (!isAnalyser || !analyserFilters.student_creation_date) return "";

      const now = new Date();
      const todayIST = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
      const todayISTDate = todayIST.toISOString().split("T")[0];

      const istDateToUTCStart = (istDateString) => {
        const [year, month, day] = istDateString.split("-");
        return `${year}-${month}-${day} 18:30:00+00`;
      };

      const istDateToUTCEnd = (istDateString) => {
        const [year, month, day] = istDateString.split("-");
        const date = new Date(Date.UTC(year, month - 1, parseInt(day) + 1));
        const nextDay = date.toISOString().split("T")[0];
        return `${nextDay} 18:30:00+00`;
      };

      switch (analyserFilters.student_creation_date) {
        case "today": {
          const startUTC = istDateToUTCStart(todayISTDate);
          const endUTC = istDateToUTCEnd(todayISTDate);
          return `s.created_at >= '${startUTC}' AND s.created_at < '${endUTC}'`;
        }
        case "yesterday": {
          const yesterday = new Date(todayIST);
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayISTDate = yesterday.toISOString().split("T")[0];
          const startUTC = istDateToUTCStart(yesterdayISTDate);
          const endUTC = istDateToUTCEnd(yesterdayISTDate);
          return `s.created_at >= '${startUTC}' AND s.created_at < '${endUTC}'`;
        }
        case "last_7_days": {
          const sevenDaysAgo = new Date(todayIST);
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          const sevenDaysAgoISTDate = sevenDaysAgo.toISOString().split("T")[0];
          const startUTC = istDateToUTCStart(sevenDaysAgoISTDate);
          const endUTC = istDateToUTCEnd(todayISTDate);
          return `s.created_at >= '${startUTC}' AND s.created_at < '${endUTC}'`;
        }
        case "last_30_days": {
          const thirtyDaysAgo = new Date(todayIST);
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          const thirtyDaysAgoISTDate = thirtyDaysAgo
            .toISOString()
            .split("T")[0];
          const startUTC = istDateToUTCStart(thirtyDaysAgoISTDate);
          const endUTC = istDateToUTCEnd(todayISTDate);
          return `s.created_at >= '${startUTC}' AND s.created_at < '${endUTC}'`;
        }
        case "this_month": {
          const firstDayOfMonth = new Date(
            todayIST.getFullYear(),
            todayIST.getMonth(),
            1,
          );
          const firstDayISTDate = firstDayOfMonth.toISOString().split("T")[0];
          const startUTC = istDateToUTCStart(firstDayISTDate);
          const endUTC = istDateToUTCEnd(todayISTDate);
          return `s.created_at >= '${startUTC}' AND s.created_at < '${endUTC}'`;
        }
        case "last_month": {
          const firstDayOfLastMonth = new Date(
            todayIST.getFullYear(),
            todayIST.getMonth() - 1,
            1,
          );
          const lastDayOfLastMonth = new Date(
            todayIST.getFullYear(),
            todayIST.getMonth(),
            0,
          );
          const firstDayISTDate = firstDayOfLastMonth
            .toISOString()
            .split("T")[0];
          const lastDayISTDate = lastDayOfLastMonth.toISOString().split("T")[0];
          const startUTC = istDateToUTCStart(firstDayISTDate);
          const endUTC = istDateToUTCEnd(lastDayISTDate);
          return `s.created_at >= '${startUTC}' AND s.created_at < '${endUTC}'`;
        }
        default:
          return "";
      }
    };

    let whereConds = [];
    let studentWhereConds = [];
    let analyserCTEConditions = "";

    if (isAnalyser) {
      if (analyserFilters.sources && analyserFilters.sources.length > 0) {
        const sourceCondition = `s.source IN ('${analyserFilters.sources.map((v) => v.trim().replace(/'/g, "''")).join("','")}')`;
        whereConds.push(sourceCondition);
        studentWhereConds.push(sourceCondition);
        analyserCTEConditions = `INNER JOIN students s_fb ON sla.student_id = s_fb.student_id AND (s_fb.source IN ('${analyserFilters.sources.map((v) => v.trim().replace(/'/g, "''")).join("','")}'))`;
      }

      if (analyserFilters.campaigns && analyserFilters.campaigns.length > 0) {
        whereConds.push(
          `first_la.utm_campaign IN ('${analyserFilters.campaigns.map((v) => v.trim().replace(/'/g, "''")).join("','")}')`,
        );
        analyserCTEConditions += analyserCTEConditions
          ? ` AND (first_la.utm_campaign IN ('${analyserFilters.campaigns.map((v) => v.trim().replace(/'/g, "''")).join("','")}') OR first_la.utm_campaign IS NULL)`
          : `INNER JOIN students s_fb ON sla.student_id = s_fb.student_id AND (first_la.utm_campaign IN ('${analyserFilters.campaigns.map((v) => v.trim().replace(/'/g, "''")).join("','")}') OR first_la.utm_campaign IS NULL)`;
      }

      if (
        analyserFilters.source_urls &&
        analyserFilters.source_urls.length > 0
      ) {
        const sourceUrlCondition = `(s.first_source_url IN ('${analyserFilters.source_urls.map((v) => v.trim().replace(/'/g, "''")).join("','")}') OR s.first_source_url IS NULL)`;
        whereConds.push(sourceUrlCondition);
        studentWhereConds.push(sourceUrlCondition);
      }

      const analyserDateFilter = applyAnalyserDateFilter();
      if (analyserDateFilter) {
        whereConds.push(analyserDateFilter);
        studentWhereConds.push(analyserDateFilter);
      }
    } else if (source) {
      const sourceCondition = `s.source IN ('${source_array.map((v) => v.trim().replace(/'/g, "''")).join("','")}')`;
      whereConds.push(sourceCondition);
      studentWhereConds.push(sourceCondition);
    }

    if (
      (created_at_start || created_at_end) &&
      !(isAnalyser && analyserFilters.student_creation_date)
    ) {
      const dateCondition = dateRangeSQL(
        "s.created_at",
        created_at_start,
        created_at_end,
      );
      whereConds.push(dateCondition);
      studentWhereConds.push(dateCondition);
    }

    const wrapArrayForSQL = (arr) =>
      `('${arr.map((v) => v.trim().replace(/'/g, "''")).join("','")}')`;

    if (
      utm_campaign &&
      !(
        isAnalyser &&
        analyserFilters.campaigns &&
        analyserFilters.campaigns.length > 0
      )
    ) {
      whereConds.push(`first_la.utm_campaign IN ${wrapArrayForSQL(utm_array)}`);
    }

    if (counsellor_id) {
      whereConds.push(
        `(c.counsellor_id IN ${wrapArrayForSQL(counsellor_array)} OR s.assigned_counsellor_id IN ${wrapArrayForSQL(counsellor_array)})`,
      );
    }

    const whereSQL = whereConds.length
      ? `WHERE ${whereConds.join(" AND ")}`
      : "";

    let groupByField;
    let groupByClause;
    let supervisorSelect;
    let counsellorJoin = "";
    let counsellorStatusCondition = "";

    if (type === "agent") {
      groupByField = `
  CASE 
    WHEN assigned_counsellor.counsellor_name IS NOT NULL AND assigned_counsellor.counsellor_name != '' 
      THEN assigned_counsellor.counsellor_name
    WHEN c.counsellor_name IS NOT NULL AND c.counsellor_name != '' 
      THEN c.counsellor_name
    ELSE 'Unassigned'
  END
`;

      supervisorSelect = `
  MAX(
    CASE 
      WHEN assigned_counsellor.assigned_to IS NOT NULL AND assigned_counsellor.assigned_to != '' 
        THEN (SELECT counsellor_name FROM counsellors WHERE counsellor_id = assigned_counsellor.assigned_to)
      WHEN c.assigned_to IS NOT NULL AND c.assigned_to != '' 
        THEN (SELECT counsellor_name FROM counsellors WHERE counsellor_id = c.assigned_to)
      ELSE 'No Supervisor'
    END
  ) AS supervisor_name
`;

      groupByClause = `
  COALESCE(assigned_counsellor.counsellor_id, c.counsellor_id),
  ${groupByField}
`;

      counsellorJoin = `
        LEFT JOIN counsellors assigned_counsellor ON s.assigned_counsellor_id = assigned_counsellor.counsellor_id
      `;

      if (counsellor_status) {
        counsellorStatusCondition = `AND (assigned_counsellor.status = '${counsellor_status}' OR c.status = '${counsellor_status}')`;
      }
    } else if (type === "source") {
      groupByField = `COALESCE(NULLIF(s.source, ''), 'NA')`;
      supervisorSelect = `'NA' AS supervisor_name`;
      groupByClause = `${groupByField}`;
    } else if (type === "campaign") {
      groupByField = `COALESCE(NULLIF(first_la.utm_campaign, ''), 'NA')`;
      supervisorSelect = `'NA' AS supervisor_name`;
      groupByClause = `${groupByField}`;
    } else if (type === "created_at") {
      groupByField = `DATE(s.created_at AT TIME ZONE 'Asia/Kolkata')`;
      supervisorSelect = `'NA' AS supervisor_name`;
      groupByClause = `${groupByField}`;
    } else if (type === "source_url") {
      groupByField = `
        CASE 
          WHEN s.first_source_url IS NULL OR TRIM(s.first_source_url) = '' THEN 'NA'
          ELSE TRIM(SPLIT_PART(s.first_source_url, '?', 1))
        END
      `;
      supervisorSelect = `'NA' AS supervisor_name`;
      groupByClause = `${groupByField}`;
    }

    const buildCTECondition = (tableAlias) => {
      if (
        !isAnalyser ||
        !analyserFilters.sources ||
        analyserFilters.sources.length === 0
      ) {
        return "";
      }
      return `INNER JOIN students s_fb ON ${tableAlias}.student_id = s_fb.student_id AND s_fb.source IN ('${analyserFilters.sources.map((v) => v.trim().replace(/'/g, "''")).join("','")}')`;
    };

    const studentWhereSQL = studentWhereConds.length
      ? `WHERE ${studentWhereConds.join(" AND ")}`
      : "";

    const firstLaCTE = `
      SELECT DISTINCT ON (sla.student_id)
        sla.student_id,
        sla.utm_campaign,
        sla.created_at
      FROM student_lead_activities sla
      ${buildCTECondition("sla")}
      ${analyserFilters.campaigns && analyserFilters.campaigns.length > 0
        ? `WHERE (sla.utm_campaign IN ('${analyserFilters.campaigns.map((v) => v.trim().replace(/'/g, "''")).join("','")}') OR sla.utm_campaign IS NULL)`
        : ""
      }
      ORDER BY sla.student_id, sla.created_at ASC, sla.id ASC
    `;

    const lastRemarkCTE = `
      SELECT DISTINCT ON (sr.student_id) 
        sr.student_id,
        sr.counsellor_id,
        sr.remark_id
      FROM student_remarks sr
      ${buildCTECondition("sr")}
      ORDER BY sr.student_id, sr.created_at DESC, sr.remark_id DESC
    `;

    const connectedRemarksCountCTE = `
      SELECT 
        sr.student_id,
        COUNT(*) as connected_remarks_count
      FROM student_remarks sr
      ${buildCTECondition("sr")}
      WHERE LOWER(TRIM(sr.calling_status)) = 'connected'
      GROUP BY sr.student_id
    `;

    const studentRemarkCountCTE = `
      SELECT 
        sr.student_id,
        COUNT(*) as total_remarks_count
      FROM student_remarks sr
      ${buildCTECondition("sr")}
      GROUP BY sr.student_id
    `;

    const preNICTE = `
      WITH eligible_students AS (
        SELECT student_id
        FROM student_remarks sr
        WHERE NOT EXISTS (
          SELECT 1 
          FROM student_remarks ex 
          WHERE ex.student_id = sr.student_id
            AND (
              ex.lead_sub_status = 'Initial Counseling Completed'
              OR ex.lead_status IN ('Application', 'Admission')
            )
        )
        GROUP BY student_id
        HAVING (
          (COUNT(*) = 1 AND BOOL_AND(lead_status = 'NotInterested'))
          OR
          (
            COUNT(*) > 1
            AND MAX(created_at) FILTER (
              WHERE lead_status = 'NotInterested'
            ) = MAX(created_at)
            AND NOT BOOL_OR(
              lead_status IN ('Admission', 'Application')
              OR lead_sub_status = 'Initial Counseling Completed'
            )
          )
          OR
          (COUNT(*) > 1 AND BOOL_AND(lead_status = 'NotInterested'))
        )
      )
      SELECT student_id FROM eligible_students
    `;

    let sortColumn;
    if (sortBy) {
      const sortMap = {
        admission: "admission_count",
        formfilled: "formFilled",
        leads: "lead_count",
        connected: "connectedAnytime",
        icc: "icc",
        active: "active_cases",
        name: "group_by",
        supervisor: "supervisor_name",
        preni: "pre_ni_count",
        prenipercent: "pre_ni_percent",
      };

      sortColumn = sortMap[sortBy.toLowerCase()] || "admission_count";
    } else {
      if (type === "created_at") {
        sortColumn = "group_by";
      } else if (type === "agent" && sortBy === "supervisor") {
        sortColumn = "supervisor_name";
      } else {
        sortColumn = "group_by";
      }
    }

    const defaultSortOrder = type === "created_at" ? "DESC" : "ASC";
    const finalSortOrder = sortOrder || defaultSortOrder;

    let mainQuery = `
      WITH first_la AS (${firstLaCTE}),
           last_remark AS (${lastRemarkCTE}),
           connected_remarks_count AS (${connectedRemarksCountCTE}),
           student_remark_count AS (${studentRemarkCountCTE}),
           pre_ni_students AS (${preNICTE})
           
      SELECT
        ${groupByField} AS group_by,
        ${supervisorSelect},
        
        COUNT(DISTINCT s.student_id) AS lead_count,
        
        COUNT(DISTINCT CASE 
          WHEN src.total_remarks_count IS NULL OR src.total_remarks_count = 0
          THEN s.student_id 
        END) AS freshCount,

        COUNT(DISTINCT CASE 
          WHEN pns.student_id IS NOT NULL
          THEN s.student_id 
        END) AS pre_ni_count,

        COUNT(DISTINCT CASE 
          WHEN s.current_student_status = 'Pre Application'
          THEN s.student_id 
        END) AS pre_application_count,

        COUNT(DISTINCT CASE 
          WHEN (src.total_remarks_count IS NULL OR src.total_remarks_count = 0) 
             OR s.current_student_status = 'Pre Application'
          THEN s.student_id 
        END) AS active_cases,

        COUNT(DISTINCT CASE 
          WHEN src.total_remarks_count > 0
          THEN s.student_id 
        END) AS attempted,

        COUNT(DISTINCT CASE 
          WHEN EXISTS (
            SELECT 1 FROM course_status_journeys csj
            WHERE csj.student_id = s.student_id 
            AND csj.course_status IN ('Application', 'Admission', 'Enrolled')
          ) THEN s.student_id 
        END) AS formFilled,

        COUNT(DISTINCT CASE 
          WHEN EXISTS (
            SELECT 1 FROM course_status_journeys csj
            WHERE csj.student_id = s.student_id 
            AND csj.course_status IN ('Admission', 'Enrolled')
          ) THEN s.student_id 
        END) AS admission_count,

        COUNT(DISTINCT CASE 
          WHEN s.current_student_status = 'Enrolled'
          THEN s.student_id 
        END) AS enrolled,

        COUNT(DISTINCT CASE 
          WHEN s.current_student_status = 'NotInterested'
          THEN s.student_id 
        END) AS ni,

        COUNT(DISTINCT CASE WHEN EXISTS (
          SELECT 1 FROM student_remarks sr2
          ${buildCTECondition("sr2")}
          WHERE sr2.student_id = s.student_id 
          AND LOWER(TRIM(sr2.calling_status)) = 'connected'
        ) THEN s.student_id END) as connectedAnytime,

        COUNT(DISTINCT CASE 
          WHEN s."first_Icc_Date" IS NOT NULL 
          THEN s.student_id 
        END) as icc,

        COUNT(DISTINCT CASE 
          WHEN (src.total_remarks_count IS NULL OR src.total_remarks_count = 0)
             OR (s.current_student_status = 'Pre Application' AND (crc.connected_remarks_count IS NULL OR crc.connected_remarks_count < 4))
          THEN s.student_id 
        END) AS under_3_remarks,

        COUNT(DISTINCT CASE 
          WHEN s.current_student_status = 'Pre Application'
            AND crc.connected_remarks_count BETWEEN 4 AND 7
          THEN s.student_id 
        END) AS remarks_4_7,

        COUNT(DISTINCT CASE 
          WHEN s.current_student_status = 'Pre Application'
            AND crc.connected_remarks_count BETWEEN 8 AND 10
          THEN s.student_id 
        END) AS remarks_8_10,

        COUNT(DISTINCT CASE 
          WHEN s.current_student_status = 'Pre Application'
            AND crc.connected_remarks_count > 10
          THEN s.student_id 
        END) AS remarks_gt_10

      FROM students s
      LEFT JOIN last_remark lr ON s.student_id = lr.student_id
      LEFT JOIN first_la ON s.student_id = first_la.student_id
      LEFT JOIN connected_remarks_count crc ON s.student_id = crc.student_id
      LEFT JOIN student_remark_count src ON s.student_id = src.student_id
      LEFT JOIN pre_ni_students pns ON s.student_id = pns.student_id
      LEFT JOIN counsellors c ON lr.counsellor_id = c.counsellor_id
      ${counsellorJoin}
    `;

    if (whereSQL || counsellorStatusCondition) {
      mainQuery += " WHERE ";
      if (whereSQL) {
        mainQuery += whereSQL.substring(6);
      }
      if (counsellorStatusCondition) {
        if (whereSQL) mainQuery += " AND ";
        mainQuery += counsellorStatusCondition.substring(4);
      }
    }

    mainQuery += `
      GROUP BY ${groupByClause}
      ORDER BY ${sortColumn} ${finalSortOrder}
    `;

    const groupedRows = await sequelize.query(mainQuery, {
      type: sequelize.QueryTypes.SELECT,
    });

    if (type === "agent") {
      let allCounsellorsQuery = `
        SELECT 
          counsellor_id,
          counsellor_name,
          status,
          assigned_to,
          (SELECT counsellor_name FROM counsellors c2 WHERE c2.counsellor_id = c1.assigned_to) as supervisor_name
        FROM counsellors c1
        WHERE 1=1
      `;

      if (counsellor_status) {
        allCounsellorsQuery += ` AND status = '${counsellor_status}'`;
      }

      allCounsellorsQuery += ` ORDER BY counsellor_name`;

      const allCounsellors = await sequelize.query(allCounsellorsQuery, {
        type: sequelize.QueryTypes.SELECT,
      });

      const existingResultsMap = {};
      groupedRows.forEach((row) => {
        if (row.group_by && row.group_by !== "Unassigned") {
          existingResultsMap[row.group_by] = row;
        }
      });

      const existingByCounsellorId = {};
      groupedRows.forEach((row) => {
        if (row.counsellor_id) {
          existingByCounsellorId[row.counsellor_id] = row;
        }
      });

      const mergedRows = allCounsellors.map((counsellor) => {
        const counsellorName = counsellor.counsellor_name;
        const existingRow =
          existingResultsMap[counsellorName] ||
          existingByCounsellorId[counsellor.counsellor_id];

        if (existingRow) {
          return {
            ...existingRow,
            counsellor_id: counsellor.counsellor_id,
            counsellor_status: counsellor.status,
            supervisor_name:
              counsellor.supervisor_name ||
              existingRow.supervisor_name ||
              "No Supervisor",
          };
        } else {
          return {
            group_by: counsellorName,
            supervisor_name: counsellor.supervisor_name || "No Supervisor",
            counsellor_id: counsellor.counsellor_id,
            counsellor_status: counsellor.status,
            lead_count: 0,
            freshCount: 0,
            pre_ni_count: 0,
            pre_application_count: 0,
            active_cases: 0,
            attempted: 0,
            formFilled: 0,
            admission_count: 0,
            enrolled: 0,
            ni: 0,
            connectedAnytime: 0,
            icc: 0,
            under_3_remarks: 0,
            remarks_4_7: 0,
            remarks_8_10: 0,
            remarks_gt_10: 0,
          };
        }
      });

      const unassignedRow = groupedRows.find(
        (row) => row.group_by === "Unassigned",
      );
      if (unassignedRow) {
        if (
          !counsellor_status ||
          (counsellor_status === "active" && unassignedRow)
        ) {
          mergedRows.push({
            ...unassignedRow,
            counsellor_status: "unassigned",
          });
        }
      }

      groupedRows.length = 0;
      groupedRows.push(...mergedRows);
    }

    const getValue = (row, prop) => {
      const lowerProp = prop.toLowerCase();
      for (const key in row) {
        if (key.toLowerCase() === lowerProp) {
          return Number(row[key]) || 0;
        }
      }
      return 0;
    };

    const formatRow = (row) => {
      const lead_count = getValue(row, "lead_count");
      const ni = getValue(row, "ni");
      const enrolled = getValue(row, "enrolled");
      const admission_count = getValue(row, "admission_count");
      const pre_ni_count = getValue(row, "pre_ni_count");

      const freshCount = getValue(row, "freshCount");
      const pre_application_count = getValue(row, "pre_application_count");
      const active_cases = getValue(row, "active_cases");
      const formFilled = getValue(row, "formFilled");
      const connectedAnytime = getValue(row, "connectedAnytime");
      const icc = getValue(row, "icc");
      const attempted = getValue(row, "attempted");

      const under_3_remarks = getValue(row, "under_3_remarks");
      const remarks_4_7 = getValue(row, "remarks_4_7");
      const remarks_8_10 = getValue(row, "remarks_8_10");
      const remarks_gt_10 = getValue(row, "remarks_gt_10");

      return {
        group_by: row.group_by,
        supervisor_name: row.supervisor_name || "No Supervisor",
        counsellor_status: row.counsellor_status || "active",
        lead_count,
        total_leads: lead_count,
        freshCount,
        preNI: pre_ni_count,
        preNIPercent:
          lead_count > 0
            ? Number(((pre_ni_count / lead_count) * 100).toFixed(1))
            : 0,
        attempted,
        formFilled,
        formfilled: formFilled,
        admission: admission_count,
        connectedAnytime,
        icc,
        connectedAnytimePercent:
          lead_count > 0
            ? Number(((connectedAnytime / lead_count) * 100).toFixed(1))
            : 0,
        iccPercent:
          lead_count > 0 ? Number(((icc / lead_count) * 100).toFixed(1)) : 0,
        leadToForm:
          attempted > 0
            ? Number(((formFilled / attempted) * 100).toFixed(1))
            : 0,
        formToAdmission:
          formFilled > 0
            ? Number(((admission_count / formFilled) * 100).toFixed(1))
            : 0,
        leadToAdmission:
          attempted > 0
            ? Number(((admission_count / attempted) * 100).toFixed(1))
            : 0,
        active_cases: active_cases,
        ni,
        enrolled,
        application: formFilled,
        under_3_remarks,
        remarks_4_7,
        remarks_8_10,
        remarks_gt_10,
      };
    };

    const calculateOverall = (rawRows) => {
      const overall = {
        group_by: "Total",
        supervisor_name: "All Supervisors",
        counsellor_status: "all",
        lead_count: 0,
        freshCount: 0,
        pre_ni_count: 0,
        pre_application_count: 0,
        attempted: 0,
        formFilled: 0,
        admission_count: 0,
        enrolled: 0,
        ni: 0,
        connectedAnytime: 0,
        icc: 0,
        active_cases: 0,
        under_3_remarks: 0,
        remarks_4_7: 0,
        remarks_8_10: 0,
        remarks_gt_10: 0,
      };

      rawRows.forEach((row) => {
        overall.lead_count += getValue(row, "lead_count");
        overall.freshCount += getValue(row, "freshCount");
        overall.pre_ni_count += getValue(row, "pre_ni_count");
        overall.pre_application_count += getValue(row, "pre_application_count");
        overall.attempted += getValue(row, "attempted");
        overall.formFilled += getValue(row, "formFilled");
        overall.admission_count += getValue(row, "admission_count");
        overall.enrolled += getValue(row, "enrolled");
        overall.ni += getValue(row, "ni");
        overall.connectedAnytime += getValue(row, "connectedAnytime");
        overall.icc += getValue(row, "icc");
        overall.active_cases += getValue(row, "active_cases");
        overall.under_3_remarks += getValue(row, "under_3_remarks");
        overall.remarks_4_7 += getValue(row, "remarks_4_7");
        overall.remarks_8_10 += getValue(row, "remarks_8_10");
        overall.remarks_gt_10 += getValue(row, "remarks_gt_10");
      });

      return overall;
    };

    const grouped = groupedRows.map(formatRow);
    const overallRaw = calculateOverall(groupedRows);
    const overall = formatRow(overallRaw);

    let groupedBySupervisor = null;
    if (type === "agent") {
      const supervisorGroups = {};

      grouped.forEach((row) => {
        const supervisorName = row.supervisor_name || "No Supervisor";

        if (!supervisorGroups[supervisorName]) {
          supervisorGroups[supervisorName] = {
            supervisorName,
            counsellor_status: row.counsellor_status || "active",
            lead_count: 0,
            freshCount: 0,
            preNI: 0,
            attempted: 0,
            formFilled: 0,
            admission_count: 0,
            connectedAnytime: 0,
            icc: 0,
            active_cases: 0,
            counsellors: [],
          };
        }

        supervisorGroups[supervisorName].counsellors.push(row);
        supervisorGroups[supervisorName].lead_count += row.lead_count;
        supervisorGroups[supervisorName].freshCount += row.freshCount;
        supervisorGroups[supervisorName].preNI += row.preNI || 0;
        supervisorGroups[supervisorName].attempted += row.attempted;
        supervisorGroups[supervisorName].formFilled += row.formFilled;
        supervisorGroups[supervisorName].admission_count += row.admission_count;
        supervisorGroups[supervisorName].connectedAnytime +=
          row.connectedAnytime;
        supervisorGroups[supervisorName].icc += row.icc;
        supervisorGroups[supervisorName].active_cases += row.active_cases;
      });

      Object.values(supervisorGroups).forEach((supervisorGroup) => {
        const lead_count = supervisorGroup.lead_count;
        supervisorGroup.connectedAnytimePercent =
          lead_count > 0
            ? Number(
              ((supervisorGroup.connectedAnytime / lead_count) * 100).toFixed(
                1,
              ),
            )
            : 0;
        supervisorGroup.iccPercent =
          lead_count > 0
            ? Number(((supervisorGroup.icc / lead_count) * 100).toFixed(1))
            : 0;
        supervisorGroup.preNIPercent =
          lead_count > 0
            ? Number(((supervisorGroup.preNI / lead_count) * 100).toFixed(1))
            : 0;
        supervisorGroup.leadToForm =
          supervisorGroup.attempted > 0
            ? Number(
              (
                (supervisorGroup.formFilled / supervisorGroup.attempted) *
                100
              ).toFixed(1),
            )
            : 0;
        supervisorGroup.formToAdmission =
          supervisorGroup.formFilled > 0
            ? Number(
              (
                (supervisorGroup.admission_count /
                  supervisorGroup.formFilled) *
                100
              ).toFixed(1),
            )
            : 0;
      });

      groupedBySupervisor = Object.values(supervisorGroups)
        .map((group) => ({
          ...group,
          counsellors: group.counsellors.sort((a, b) => {
            if (a.group_by === "Unassigned") return 1;
            if (b.group_by === "Unassigned") return -1;
            return a.group_by.localeCompare(b.group_by);
          }),
        }))
        .sort((a, b) => {
          if (a.supervisorName === "No Supervisor") return 1;
          if (b.supervisorName === "No Supervisor") return -1;
          return a.supervisorName.localeCompare(b.supervisorName);
        });
    }

    const response = {
      success: true,
      data: [...grouped, overall],
      groupedBySupervisor,
      totalRecords: grouped.length,
      sortBy: sortBy || (type === "created_at" ? "date" : "name"),
      sortOrder: finalSortOrder,
    };

    if (counsellor_status) {
      response.counsellor_status_filter = counsellor_status;
    }

    if (isAnalyser) {
      response.analyser_filters_applied = analyserFilters;

      const filterDescriptions = [];
      if (analyserFilters.sources && analyserFilters.sources.length > 0) {
        filterDescriptions.push(
          `Sources: ${analyserFilters.sources.join(", ")}`,
        );
      }
      if (analyserFilters.campaigns && analyserFilters.campaigns.length > 0) {
        filterDescriptions.push(
          `Campaigns: ${analyserFilters.campaigns.join(", ")}`,
        );
      }
      if (
        analyserFilters.source_urls &&
        analyserFilters.source_urls.length > 0
      ) {
        filterDescriptions.push(
          `Source URLs: ${analyserFilters.source_urls.join(", ")}`,
        );
      }
      if (analyserFilters.student_creation_date) {
        filterDescriptions.push(
          `Date Filter: ${analyserFilters.student_creation_date.replace(/_/g, " ")}`,
        );
      }

      response.note = `Analyser filters applied: ${filterDescriptions.join(" | ")}`;

      if (source || utm_campaign || created_at_start || created_at_end) {
        response.user_filters_note =
          "User-provided filters were overridden by analyser-specific filters";
      }
    }

    if (type === "agent") {
      response.note = response.note ? response.note + " | " : "";
      response.note +=
        "Includes all counsellors (including those with zero leads)";

      if (counsellor_status) {
        response.note += ` | Filtered by status: ${counsellor_status}`;
      }
    }

    res.status(200).json(response);
  } catch (error) {
    console.error("Error in getThreeRecordsOfFormFilled:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
};