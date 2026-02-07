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

  try {
    const body = await readBody(req);

    const { env, appId, appCode } = body;

    if (!env || !appId || !appCode) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          success: false,
          error: "Missing required fields: env, appId, appCode",
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

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    /**
     * UPDATE ONLY — app must already exist
     */
    const query = `
      UPDATE app
      SET
        app_code = $1,
        updated_at = NOW()
      WHERE app_id = $2
      RETURNING app_id, updated_at;
    `;

    const values = [appCode, appId];

    const result = await client.query(query, values);
    await client.end();

    if (result.rowCount === 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          success: false,
          error: "App not found",
        }),
      );
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        success: true,
        environment: env,
        appId: result.rows[0].app_id,
        updatedAt: result.rows[0].updated_at,
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
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Publish server running on port ${PORT}`);
});
