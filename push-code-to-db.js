require("dotenv").config();
const http = require("http");
const { Client } = require("pg");

/**
 * Select DB based on env
 */
function getDbUrl(env) {
  if (env === "prestaging") return process.env.PRESTAGING_DB_URL;
  if (env === "staging") return process.env.STAGING_DB_URL;
  if (env === "production") return process.env.PRODUCTION_DB_URL;
  return null;
}

/**
 * Read JSON body
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/publish") {
    res.writeHead(404);
    return res.end("Not found");
  }

  let client;

  try {
    const body = await readBody(req);

    const {
      env,
      appId,
      appName,
      appVersion,
      appCode,
      hasTriggers,
      hasActions,
      gitSha,
      tags,
    } = body;

    if (!env || !appId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          success: false,
          error: "Missing required fields: env, appId",
        }),
      );
    }

    const databaseUrl = getDbUrl(env);
    if (!databaseUrl) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          success: false,
          error: "Invalid environment",
        }),
      );
    }

    client = new Client({ connectionString: databaseUrl });
    await client.connect();

    /**
     * 1️⃣ Check if app exists
     */
    const existsResult = await client.query(
      `SELECT app_id FROM app WHERE app_id = $1`,
      [appId],
    );

    /**
     * 2️⃣ UPDATE if exists
     */
    if (existsResult.rowCount > 0) {
      const updates = [];
      const values = [];
      let idx = 1;

      if (appName !== undefined) {
        updates.push(`app_name = $${idx++}`);
        values.push(appName);
      }

      if (appVersion !== undefined) {
        updates.push(`app_version = $${idx++}`);
        values.push(appVersion);
      }

      if (appCode !== undefined) {
        updates.push(`app_code = $${idx++}`);
        values.push(appCode);
      }

      if (hasTriggers !== undefined) {
        updates.push(`has_triggers = $${idx++}`);
        values.push(hasTriggers);
      }

      if (hasActions !== undefined) {
        updates.push(`has_actions = $${idx++}`);
        values.push(hasActions);
      }

      if (gitSha !== undefined) {
        updates.push(`git_sha = $${idx++}`);
        values.push(gitSha);
      }

      if (tags !== undefined) {
        updates.push(`tags = $${idx++}::jsonb`);
        values.push(JSON.stringify(tags));
      }

      updates.push(`updated_at = CURRENT_TIMESTAMP`);

      if (updates.length === 1) {
        throw new Error("No fields provided to update");
      }

      const updateQuery = `
        UPDATE app
        SET ${updates.join(", ")}
        WHERE app_id = $${idx}
        RETURNING app_id, updated_at;
      `;

      values.push(appId);

      const result = await client.query(updateQuery, values);

      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          success: true,
          action: "updated",
          environment: env,
          appId: result.rows[0].app_id,
          updatedAt: result.rows[0].updated_at,
        }),
      );
    }

    /**
     * 3️⃣ INSERT if not exists
     */
    if (!appName || !appVersion || !appCode || !hasTriggers || !hasActions) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          success: false,
          error:
            "appName, appVersion and appCode are required when creating a new app",
        }),
      );
    }

    const insertQuery = `
      INSERT INTO app (
        app_name,
        app_id,
        app_version,
        app_code,
        has_triggers,
        has_actions,
        git_sha,
        tags,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      RETURNING app_id, created_at;
    `;

    const insertValues = [
      appName,
      appId,
      appVersion,
      appCode,
      hasTriggers,
      hasActions,
      gitSha ?? null,
      tags ? JSON.stringify(tags) : [],
    ];

    const insertResult = await client.query(insertQuery, insertValues);

    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        success: true,
        action: "created",
        environment: env,
        appId: insertResult.rows[0].app_id,
        createdAt: insertResult.rows[0].created_at,
      }),
    );
  } catch (error) {
    console.error("Publish error:", error);
    res.writeHead(500, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        success: false,
        error: error.message || "Internal server error",
      }),
    );
  } finally {
    if (client) {
      await client.end();
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Publish server running on port ${PORT}`);
});
