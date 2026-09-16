const express = require("express");
const router = express.Router();

const Anthropic = require("@anthropic-ai/sdk");
const scenarios = require("../data/scenarios");

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

// Temporary in-memory sessions
const sessions = {};

// Create a new negotiation session
router.post("/", (req, res) => {
    const { scenarioId, scenario: scenarioData } = req.body;

    let scenario;

    // If the frontend sends a complete scenario, use it
    if (scenarioData) {
        if (
            !scenarioData.id ||
            !scenarioData.name ||
            !scenarioData.supplierRole ||
            !scenarioData.brief ||
            !scenarioData.objective
        ) {
            return res.status(400).json({
                error: "Incomplete scenario data"
            });
        }

        scenario = scenarioData;
    }

    // Otherwise, use one of the backend's built-in scenarios
    else {
        if (!scenarioId) {
            return res.status(400).json({
                error: "scenarioId is required"
            });
        }

        scenario = scenarios.find(
            scenario => scenario.id === parseInt(scenarioId)
        );

        if (!scenario) {
            return res.status(404).json({
                error: "Scenario not found"
            });
        }
    }

    const session = {
        id: Date.now().toString(),
        scenarioId: scenario.id,
        scenarioTitle: scenario.name || scenario.title,
        scenario: scenario,
        status: "active",
        startedAt: new Date().toISOString(),
        messages: []
    };

    sessions[session.id] = session;

    res.status(201).json(session);
});

// Send a negotiation message
router.post("/:sessionId/messages", async (req, res) => {
    const { sessionId } = req.params;
    const { message } = req.body;

    const session = sessions[sessionId];

    if (!session) {
        return res.status(404).json({
            error: "Session not found"
        });
    }

    if (!message || !message.trim()) {
        return res.status(400).json({
            error: "Message is required"
        });
    }

    // Add user's message
    session.messages.push({
        sender: "user",
        message: message.trim(),
        timestamp: new Date().toISOString()
    });

    // Ask Claude to respond as the supplier
try {
    const supplierResponse = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 500,
    system: `
You are the supplier in a realistic procurement negotiation.

Stay fully in character as the supplier.

The buyer is negotiating about:
${session.scenario.name}

Supplier role:
${session.scenario.supplierRole}

Scenario:
${session.scenario.brief}

Supplier objective:
${session.scenario.objective}

Rules:
- Respond naturally as a real supplier would.
- Do not immediately agree to the buyer's requests.
- Protect the supplier's commercial interests.
- Negotiate rather than simply answering questions.
- Make reasonable concessions only when the buyer gives something in return.
- Use realistic supplier negotiation tactics.
- Do not reveal hidden objectives or private information.
- Keep responses conversational and reasonably concise.
`,
    messages: session.messages.map(m => ({
        role: m.sender === "user" ? "user" : "assistant",
        content: m.message
    }))
});

const supplierText = supplierResponse.content.find(
    block => block.type === "text"
);

if (!supplierText) {
    throw new Error("Claude returned no text response");
}

session.messages.push({
    sender: "supplier",
    message: supplierText.text,
    timestamp: new Date().toISOString()
});

} catch (error) {
    console.error("Claude API error:", error);

    return res.status(500).json({
        error: "Supplier simulation failed"
    });
}

res.json({
    sessionId: session.id,
    messages: session.messages
});
});

// Generate negotiation debrief
router.post("/:sessionId/debrief", async (req, res) => {
    const { sessionId } = req.params;

    const session = sessions[sessionId];

    if (!session) {
        return res.status(404).json({
            error: "Session not found"
        });
    }

    if (!session.messages || session.messages.length === 0) {
        return res.status(400).json({
            error: "No negotiation messages to debrief"
        });
    }

    try {
        const debriefResponse = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 1200,
            system: `
You are an expert procurement negotiation coach.

Analyse the completed negotiation between a buyer and supplier.

Scenario:
${session.scenario.name}

Supplier role:
${session.scenario.supplierRole}

Scenario brief:
${session.scenario.brief}

Supplier objective:
${session.scenario.objective}

Review the full negotiation below.

Provide a useful, honest and practical procurement debrief.

Return ONLY valid JSON in exactly this structure:

{
  "score": 1,
  "summary": "Short overall assessment.",
  "strengths": [
    "Strength 1",
    "Strength 2",
    "Strength 3"
  ],
  "misses": [
    "Missed opportunity 1",
    "Missed opportunity 2",
    "Missed opportunity 3"
  ],
  "supplierTactics": [
    "Supplier tactic 1",
    "Supplier tactic 2",
    "Supplier tactic 3"
  ],
  "coachingTip": "The single most useful thing the buyer could improve next time."
}

Scoring:
- Score the BUYER'S negotiation technique, not whether they achieved a particular price.
- 1 = very weak negotiation technique.
- 10 = excellent negotiation technique.
- Consider preparation, questioning, leverage, information control, trading concessions, handling supplier pressure, and clarity.
- Do not reward the buyer simply because the supplier was friendly.
- Do not penalise the buyer simply because the supplier refused a request.

Keep the feedback specific to what actually happened in the negotiation.
Do not invent actions that the buyer did not take.
`,
            messages: [
                {
                    role: "user",
                    content: session.messages
                        .map(m => `${m.sender.toUpperCase()}: ${m.message}`)
                        .join("\n\n")
                }
            ]
        });

        const debriefText = debriefResponse.content.find(
            block => block.type === "text"
        );

        if (!debriefText) {
            throw new Error("Claude returned no debrief text");
        }

        let debrief;

try {
    const cleanDebrief = debriefText.text
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

    debrief = JSON.parse(cleanDebrief);
} catch (parseError) {
    console.error("Debrief JSON parse error:", parseError);
    console.error("Claude returned:", debriefText.text);

    return res.status(500).json({
        error: "Debrief returned invalid data"
    });
}

session.debrief = debrief;
session.status = "completed";
session.completedAt = new Date().toISOString();

res.json({
    sessionId: session.id,
    debrief: debrief
});

    } catch (error) {
        console.error("Claude debrief error:", error);

        res.status(500).json({
            error: "Debrief generation failed"
        });
    }
});

// Get a session
router.get("/:sessionId", (req, res) => {
    const { sessionId } = req.params;

    const session = sessions[sessionId];

    if (!session) {
        return res.status(404).json({
            error: "Session not found"
        });
    }

    res.json(session);
});

router.post("/build-case", async (req, res) => {
    const { description } = req.body;

    if (!description || !description.trim()) {
        return res.status(400).json({
            error: "Description is required"
        });
    }

    try {
        const response = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 500,
            system: `
You are helping a procurement professional turn a real negotiation situation into a realistic training case.

The user will describe a real or past procurement negotiation in their own words.

Your job is to structure what they wrote into a concise training case.

IMPORTANT RULES:
- Use ONLY information provided by the user.
- Do not invent company names, supplier names, people, prices, percentages, dates, contract values or other specific facts.
- If important details are missing, describe the situation generally rather than making them up.
- The case should still be useful even if the user's description is short.
- Write the brief directly to the buyer using "you".
- Focus on the commercial situation, the supplier relationship, the pressure or difficulty, and what the buyer needs to achieve.
- Do not give the buyer advice.
- Do not include markdown.
- Do not include commentary before or after the JSON.

Return ONLY valid JSON in exactly this structure:

{
  "name": "3-6 word title",
  "supplierRole": "a short description of who the buyer is negotiating against",
  "brief": "2-4 sentences describing the situation, stakes and difficulty from the information provided",
  "objective": "one sentence describing what the buyer is trying to achieve"
}

Even if the user's description is brief, always return a complete JSON object containing all four fields.
`,
            messages: [
                {
                    role: "user",
                    content: description.trim()
                }
            ]
        });

        const textBlock = response.content.find(
            block => block.type === "text"
        );

        if (!textBlock) {
            throw new Error("Claude returned no text response");
        }

        const clean = textBlock.text
            .replace(/```json/g, "")
            .replace(/```/g, "")
            .trim();

        const parsed = JSON.parse(clean);

        res.json(parsed);

    } catch (error) {
        console.error("Case builder error:", error);

        res.status(500).json({
            error: "Couldn't build the case"
        });
    }
});

module.exports = router;