const http = require("node:http");

http
  .get("http://127.0.0.1:5000/api/health", (res) => {
    res.resume();
    process.exit(res.statusCode === 200 ? 0 : 1);
  })
  .on("error", () => process.exit(1));
