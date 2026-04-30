const http = require("http");
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ service: "api", path: req.url, ok: true }));
});

server.listen(PORT, () => {
  console.log(`compose-stack-api listening on :${PORT}`);
});
