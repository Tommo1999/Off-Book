const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

const scenarioRoutes = require("./routes/scenarios");
const sessionRoutes = require("./routes/sessions");

// Middleware
app.use(cors());
app.use(express.json());

// Serve the frontend
app.use(express.static(path.join(__dirname, "public")));

// API routes
app.use("/api/scenarios", scenarioRoutes);
app.use("/api/sessions", sessionRoutes);

// Test route
app.get("/api/test", (req, res) => {
    res.json({
        message: "Off Book backend is working!"
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Off Book server running on http://localhost:${PORT}`);
});