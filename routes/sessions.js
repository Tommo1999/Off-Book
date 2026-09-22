const express = require("express");
const router = express.Router();

const Anthropic = require("@anthropic-ai/sdk");
const scenarios = require("../data/scenarios");

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

// Temporary in-memory sessions
const sessions = {};

// Safely extract JSON from Claude responses
function parseClaudeJson(text) {
    if (!text || typeof text !== "string") {
        throw new Error("Claude returned empty or invalid text");
    }

    const cleaned = text.trim();

    // ---------------------------------------------------------
    // 1. Try parsing the response directly first
    // ---------------------------------------------------------
    try {
        return JSON.parse(cleaned);
    } catch (error) {
        // Continue below if Claude included extra formatting
    }

    // ---------------------------------------------------------
    // 2. Look for JSON inside a Markdown code block
    // ---------------------------------------------------------
    const fencedMatch = cleaned.match(
        /```(?:json)?\s*([\s\S]*?)\s*```/i
    );

    if (fencedMatch) {
        const fencedJson = fencedMatch[1].trim();

        try {
            return JSON.parse(fencedJson);
        } catch (error) {
            // Continue below if the fenced content is also malformed
        }
    }

    // ---------------------------------------------------------
    // 3. Look for a JSON object surrounded by commentary
    // ---------------------------------------------------------
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");

    if (
        firstBrace !== -1 &&
        lastBrace !== -1 &&
        lastBrace > firstBrace
    ) {
        const jsonText = cleaned.slice(firstBrace, lastBrace + 1);

        try {
            return JSON.parse(jsonText);
        } catch (error) {
            throw new Error(
                `Claude returned text containing a JSON object, but it could not be parsed: ${error.message}`
            );
        }
    }

    throw new Error("No JSON object found in Claude response");
}


// ============================================================
// CREATE A NEW NEGOTIATION SESSION
// ============================================================

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


// ============================================================
// SEND A NEGOTIATION MESSAGE
// ============================================================

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


// ============================================================
// GENERATE NEGOTIATION DEBRIEF
// ============================================================

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
  "score": 0,
  "summary": "Short overall assessment.",
  "strengths": [],
  "misses": [],
  "supplierTactics": [],
  "coachingTip": "The single most useful thing the buyer could improve next time."
}

IMPORTANT OUTPUT RULES:
- Your response must contain ONLY the JSON object.
- Do not provide an explanation before the JSON.
- Do not provide an explanation after the JSON.
- Do not use Markdown code fences.
- The first character of your response must be {.
- The final character of your response must be }.

- The score may range from 0 to 10.
- 0 = no meaningful negotiation took place, or there was insufficient buyer participation to assess negotiation technique.
- 1-2 = very weak negotiation technique.
- 3-4 = weak negotiation technique with significant areas for improvement.
- 5-6 = developing or mixed negotiation technique.
- 7-8 = good negotiation technique.
- 9 = very strong negotiation technique.
- 10 = excellent negotiation technique.
- If the buyer only sends a greeting such as "hi", "hello", "thanks", or another message that does not constitute a negotiation attempt, score 0.
- Do not give the buyer a non-zero score merely because they started the conversation.
- For a score of 0, do not invent strengths or supplier tactics simply to fill the arrays. Use an empty array when there is genuinely nothing meaningful to assess.

IMPORTANT:
- If the buyer only sends a greeting such as "hi", "hello", "thanks", or another message that does not constitute a negotiation attempt, score 0.
- If there are only one or two very short messages and no meaningful negotiation occurs, consider whether 0 is more appropriate than scoring the limited interaction.
- Do not give the buyer a non-zero score merely because they started the conversation.
- A score of 0 means there was not enough negotiation to assess; it is not a judgement that the buyer is incapable of negotiating.
- Once meaningful negotiation has taken place, score the buyer based on the quality of their actual negotiation technique.
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
                        .map(
                            m =>
                                `${m.sender.toUpperCase()}: ${m.message}`
                        )
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
            debrief = parseClaudeJson(debriefText.text);
        } catch (parseError) {
            console.error(
                "Debrief JSON parse error:",
                parseError
            );

            console.error(
                "Claude returned:",
                debriefText.text
            );

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


// ============================================================
// GET A SESSION
// ============================================================

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


// ============================================================
// BUILD CASE FROM USER DESCRIPTION
// ============================================================

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

        const parsed = parseClaudeJson(textBlock.text);

        res.json(parsed);

    } catch (error) {
        console.error("Case builder error:", error);

        res.status(500).json({
            error: "Couldn't build the case"
        });
    }
});


// ============================================================
// ANONYMIZE CASE
// ============================================================

router.post("/anonymize-case", async (req, res) => {
    const { rawText, scenario } = req.body;

    if (!rawText || !scenario) {
        return res.status(400).json({
            error: "Raw text and scenario are required"
        });
    }

    try {
        const response = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 500,

            system: `
You prepare a real negotiation scenario for an anonymous, shared training library used by other procurement professionals.

Rewrite the case so nobody could identify the company, individuals, or exact deal involved, while keeping the negotiation dynamic realistic and useful to practice.

IMPORTANT RULES:
- Remove company names.
- Remove personal names.
- Remove identifying locations.
- Remove identifying project names.
- Generalise specific numbers into realistic ranges where necessary.
- Do not invent major facts that change the negotiation.
- Keep the commercial situation and negotiation dynamic intact.
- Make the result suitable for another procurement professional to practise.
- Do not include markdown.
- Do not include commentary before or after the JSON.

Return ONLY valid JSON in exactly this structure:

{
  "name": "3-6 word title",
  "supplierRole": "a short description of who the buyer is negotiating against",
  "brief": "2-4 sentences describing the anonymised negotiation situation",
  "objective": "one sentence describing what the buyer is trying to achieve"
}
`,

            messages: [
                {
                    role: "user",
                    content: `
Buyer's raw description:

${rawText}

Structured case brief:

${JSON.stringify(scenario)}
`
                }
            ]
        });

        const textBlock = response.content.find(
            block => block.type === "text"
        );

        if (!textBlock) {
            throw new Error("Claude returned no text response");
        }

        const parsed = parseClaudeJson(textBlock.text);

        res.json(parsed);

    } catch (error) {
        console.error("Anonymisation error:", error);

        res.status(500).json({
            error: "Couldn't anonymise case"
        });
    }
});

module.exports = router;