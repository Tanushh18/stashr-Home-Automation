// Entry point: loads config, connects to MongoDB and starts listening.
const dotenv = require("dotenv");
dotenv.config({ path: "./config.env", quiet: true });
dotenv.config({ quiet: true });

const app = require("./app");
const { connect } = require("./db/connection");
const { startKeepAlive } = require("./utils/keepAlive");
const { startScheduler } = require("./utils/scheduler");
const { startHomeSweep } = require("./utils/homeSweep");

const PORT = process.env.PORT || 8000;

connect();

const server = app.listen(PORT, () =>
{
    console.log(`listening to port : http://localhost:${PORT}/`);
    console.log(`health check      : http://localhost:${PORT}/health`);

    // Self ping so free-tier hosting does not spin the instance down
    startKeepAlive();

    // Monitoring, project/link sync and usage every few minutes, inside the server
    startScheduler();
    startHomeSweep();
});

// KEEPING THE PROCESS ALIVE ON UNEXPECTED FAILURES
process.on("unhandledRejection", (reason) =>
{
    console.error("Unhandled promise rejection:", reason);
});

// After an uncaught exception the process state is undefined: log, then exit so the host restarts it cleanly.
process.on("uncaughtException", (error) =>
{
    // A timed-out or cancelled network request (a slow download, a closed browser tab) leaves the server in a good state: keep running.
    if (error && (error.name === "TimeoutError" || error.name === "AbortError"))
    {
        console.error("Ignored an aborted network request:", error.message);
        return;
    }
    console.error("Uncaught exception:", error);
    server.close(() => process.exit(1));
    setTimeout(() => process.exit(1), 5000).unref();
});

// GRACEFUL SHUTDOWN
["SIGTERM", "SIGINT"].forEach((signal) =>
{
    process.on(signal, () =>
    {
        console.log(`${signal} received, shutting down gracefully.`);
        server.close(() => process.exit(0));
    });
});
