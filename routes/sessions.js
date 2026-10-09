const express = require("express");
const router = express.Router();

const Anthropic = require("@anthropic-ai/sdk");
const scenarios = require("../data/scenarios");

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});


// ============================================================
// PRICING
// Claude Sonnet 4.6
// $3 per million input tokens
// $15 per million output tokens
// ============================================================

const INPUT_COST_PER_MILLION = 3;
const OUTPUT_COST_PER_MILLION = 15;


// ============================================================
// TEMPORARY IN-MEMORY STORAGE
// ============================================================

const sessions = {};


// Overall API usage for this server run
const usageTotals = {
    totalRequests: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUSD: 0,

    byType: {
        negotiation: {
            requests: 0,
            inputTokens: 0,
            outputTokens: 0,
            costUSD: 0
        },

        debrief: {
            requests: 0,
            inputTokens: 0,
            outputTokens: 0,
            costUSD: 0
        },

        caseBuilder: {
            requests: 0,
            inputTokens: 0,
            outputTokens: 0,
            costUSD: 0
        },

        anonymisation: {
            requests: 0,
            inputTokens: 0,
            outputTokens: 0,
            costUSD: 0
        }
    }
};


// ============================================================
// RECORD CLAUDE API USAGE
// ============================================================

function recordUsage(response, type, session = null) {

    const inputTokens =
        response.usage?.input_tokens || 0;

    const outputTokens =
        response.usage?.output_tokens || 0;

    const inputCost =
        (inputTokens / 1_000_000) *
        INPUT_COST_PER_MILLION;

    const outputCost =
        (outputTokens / 1_000_000) *
        OUTPUT_COST_PER_MILLION;

    const costUSD =
        inputCost + outputCost;


    // --------------------------------------------------------
    // Global totals
    // --------------------------------------------------------

    usageTotals.totalRequests += 1;

    usageTotals.totalInputTokens += inputTokens;

    usageTotals.totalOutputTokens += outputTokens;

    usageTotals.totalCostUSD += costUSD;


    // --------------------------------------------------------
    // Totals by request type
    // --------------------------------------------------------

    if (usageTotals.byType[type]) {

        usageTotals.byType[type].requests += 1;

        usageTotals.byType[type].inputTokens += inputTokens;

        usageTotals.byType[type].outputTokens += outputTokens;

        usageTotals.byType[type].costUSD += costUSD;
    }


    // --------------------------------------------------------
    // Session-specific usage
    // --------------------------------------------------------

    if (session) {

        if (!session.usage) {

            session.usage = {
                requests: 0,
                inputTokens: 0,
                outputTokens: 0,
                costUSD: 0,

                byType: {
                    negotiation: {
                        requests: 0,
                        inputTokens: 0,
                        outputTokens: 0,
                        costUSD: 0
                    },

                    debrief: {
                        requests: 0,
                        inputTokens: 0,
                        outputTokens: 0,
                        costUSD: 0
                    }
                }
            };
        }


        session.usage.requests += 1;

        session.usage.inputTokens += inputTokens;

        session.usage.outputTokens += outputTokens;

        session.usage.costUSD += costUSD;


        if (session.usage.byType[type]) {

            session.usage.byType[type].requests += 1;

            session.usage.byType[type].inputTokens += inputTokens;

            session.usage.byType[type].outputTokens += outputTokens;

            session.usage.byType[type].costUSD += costUSD;
        }
    }


    console.log(
        `[USAGE] ${type} | ` +
        `Input: ${inputTokens} | ` +
        `Output: ${outputTokens} | ` +
        `Cost: $${costUSD.toFixed(6)}`
    );
}


// ============================================================
// SAFELY EXTRACT JSON FROM CLAUDE RESPONSES
// ============================================================

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
        // Continue below
    }


    // ---------------------------------------------------------
    // 2. Look for JSON inside a Markdown code block
    // ---------------------------------------------------------

    const fencedMatch = cleaned.match(
        /```(?:json)?\s*([\s\S]*?)\s*```/i
    );

    if (fencedMatch) {

        const fencedJson =
            fencedMatch[1].trim();

        try {
            return JSON.parse(fencedJson);
        } catch (error) {
            // Continue below
        }
    }


    // ---------------------------------------------------------
    // 3. Look for a JSON object surrounded by commentary
    // ---------------------------------------------------------

    const firstBrace =
        cleaned.indexOf("{");

    const lastBrace =
        cleaned.lastIndexOf("}");


    if (
        firstBrace !== -1 &&
        lastBrace !== -1 &&
        lastBrace > firstBrace
    ) {

        const jsonText =
            cleaned.slice(
                firstBrace,
                lastBrace + 1
            );

        try {
            return JSON.parse(jsonText);

        } catch (error) {

            throw new Error(
                `Claude returned text containing a JSON object, but it could not be parsed: ${error.message}`
            );
        }
    }


    throw new Error(
        "No JSON object found in Claude response"
    );
}


// ============================================================
// CREATE A NEW NEGOTIATION SESSION
// ============================================================

router.post("/", (req, res) => {

    const {
    scenarioId,
    scenario: scenarioData,
    dealData,
    targetValue,
    playbook
} = req.body;

    let scenario;


    // If frontend sends a complete scenario
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


    // Otherwise use built-in scenario
    else {

        if (!scenarioId) {

            return res.status(400).json({
                error: "scenarioId is required"
            });
        }

        scenario = scenarios.find(
            scenario =>
                scenario.id === parseInt(scenarioId)
        );


        if (!scenario) {

            return res.status(404).json({
                error: "Scenario not found"
            });
        }
    }


   const session = {

        id: Date.now().toString(),

        scenarioId:
            scenario.id,

        scenarioTitle:
            scenario.name ||
            scenario.title,

        scenario: {
            ...scenario,
            targetValue:
                targetValue ||
                scenario.targetValue ||
                null
        },

        dealData:
            dealData || "",

        targetValue:
            targetValue ||
            scenario.targetValue ||
            null,

        playbook:
            playbook || "",

        status:
            "active",

        startedAt:
            new Date().toISOString(),

        messages: [],

        usage: {

            requests: 0,

            inputTokens: 0,

            outputTokens: 0,

            costUSD: 0,

            byType: {

                negotiation: {
                    requests: 0,
                    inputTokens: 0,
                    outputTokens: 0,
                    costUSD: 0
                },

                debrief: {
                    requests: 0,
                    inputTokens: 0,
                    outputTokens: 0,
                    costUSD: 0
                }
            }
        }
    };


    sessions[session.id] =
        session;


    res.status(201).json(session);
});


// ============================================================
// SEND A NEGOTIATION MESSAGE
// ============================================================

router.post(
    "/:sessionId/messages",
    async (req, res) => {

        const {
            sessionId
        } = req.params;

        const {
            message
        } = req.body;


        const session =
            sessions[sessionId];


        if (!session) {

            return res.status(404).json({
                error: "Session not found"
            });
        }


        if (
            !message ||
            !message.trim()
        ) {

            return res.status(400).json({
                error: "Message is required"
            });
        }


        // Add user's message
        session.messages.push({

            sender: "user",

            message:
                message.trim(),

            timestamp:
                new Date().toISOString()
        });


        // Ask Claude to respond as supplier

        try {

            const supplierResponse =
                await anthropic.messages.create({

                    model:
                        "claude-sonnet-4-6",

                    max_tokens:
                        150,

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
- Respond naturally as a real supplier in a live negotiation.
- Be commercially realistic and protect the supplier's interests.
- Do not immediately agree to requests or give away concessions.
- Negotiate rather than simply answering questions.
- Use realistic supplier tactics such as anchoring, urgency, bundling and conditional concessions.
- Do not reveal hidden objectives, walkaway points or private information.
- Be direct and concise.
- Maximum 2 sentences per response.
- Maximum 30 words per response.
- Ask no more than ONE question.
- Do not make small talk.
- Do not compliment the buyer.
- Do not say you are excited to work together.
- Do not introduce the company or explain its capabilities.
- Do not repeat or summarise the buyer's message.
- Do not provide multiple questions or a list of requirements.
- Respond specifically to the buyer's latest point.
`,

                    messages:
                        session.messages.map(
                            m => ({

                                role:
                                    m.sender === "user"
                                        ? "user"
                                        : "assistant",

                                content:
                                    m.message
                            })
                        )
                });


            // Record API usage
            recordUsage(
                supplierResponse,
                "negotiation",
                session
            );


            const supplierText =
    supplierResponse.content.find(
        block =>
            block.type === "text"
    );


if (!supplierText) {

    throw new Error(
        "Claude returned no text response"
    );
}


const supplierMessage =
    supplierText.text
        .replace(/\*\*/g, "")
        .trim()
        .split(/\s+/)
        .slice(0, 40)
        .join(" ");


session.messages.push({

    sender:
        "supplier",

    message:
        supplierMessage,

    timestamp:
        new Date().toISOString()
});


        } catch (error) {

            console.error(
                "Claude API error:",
                error
            );

            return res.status(500).json({
                error:
                    "Supplier simulation failed"
            });
        }


        res.json({

            sessionId:
                session.id,

            messages:
                session.messages
        });
    }
);


// ============================================================
// GENERATE NEGOTIATION DEBRIEF
// ============================================================

router.post(
    "/:sessionId/debrief",
    async (req, res) => {

        const {
            sessionId
        } = req.params;


        const session =
            sessions[sessionId];


        if (!session) {

            return res.status(404).json({
                error: "Session not found"
            });
        }


        if (
            !session.messages ||
            session.messages.length === 0
        ) {

            return res.status(400).json({
                error:
                    "No negotiation messages to debrief"
            });
        }


        try {

            const debriefResponse =
                await anthropic.messages.create({

                    model:
                        "claude-sonnet-4-6",

                    max_tokens:
                        1200,

                   system: `
You are a sharp, experienced procurement negotiation coach reviewing a completed negotiation.

SCENARIO:
${session.scenario.brief}

BUYER'S OBJECTIVE:
${session.scenario.objective}

BUYER'S TARGET:
BUYER'S PRIVATE NUMBERS:
${session.dealData || "No private numbers provided"}

BUYER'S TARGET / WALK-AWAY:
${session.targetValue || "No target or walk-away provided"}

BUYER'S PLAYBOOK:
${session.playbook || "No playbook provided"}

PREPARATION REVIEW:

Rate the buyer's preparation using the BUYER'S PRIVATE NUMBERS, TARGET / WALK-AWAY and PLAYBOOK together.

Do not penalise the buyer simply because one field is empty. Assess the preparation that was actually provided.

Credit an element only when it is present AND specific. Length does not matter.

Assess these five preparation elements:

1. TARGET AND WALK-AWAY
What a good deal looks like, and the point the buyer would walk away.

2. PRIORITIES AND TRADE-OFFS
What matters most, and what the buyer would give up to get it.

3. ALTERNATIVES
What the buyer would do if this supplier says no.

4. QUESTIONS
What the buyer needs to find out.

5. OPENING POSITION
Where the buyer will start and why.

If none of the three preparation inputs contain anything useful, say exactly:
"no preparation provided"

That is NOT a penalty and must have NO effect on the technique score.

If preparation was provided:
- Give a short overall rating.
- List which of the five elements were covered.
- List which were missed.
- Give ONE concrete nudge for improving the preparation.
- Add ONE short line comparing the plan with what the buyer actually did in the negotiation.

Keep the preparation feedback concise and practical.

Review the full negotiation transcript below.

IMPORTANT:
The buyer's TECHNIQUE SCORE and the COMMERCIAL OUTCOME are two different things.

The score measures negotiation technique ONLY.

If the buyer achieved a good commercial outcome but used weak technique, give the buyer a low technique score but clearly state that the commercial outcome was successful.

If the buyer used excellent technique but still missed their commercial target, give an appropriate technique score but clearly state that the commercial outcome missed the target.

SCORING RUBRIC — apply strictly:

0 = the buyer's turns contain no actual negotiating content at all — for example a greeting, a one-word reply, an immediate agreement with no terms discussed, or ending before any position, question or counter was made.

1-3 = engaged, but gave up control almost immediately — accepted the first position offered, asked no useful clarifying questions, made no meaningful counter-proposal.

4-6 = made some real negotiating moves — asked questions, pushed back, used some leverage or made a counter — but left clear value or control on the table.

7-9 = structured the negotiation well, used real leverage, held firm under pressure and controlled the conversation, with only minor missed opportunities.

10 = genuinely expert-level performance with no meaningful technique gaps.

If the buyer's combined turns contain fewer than roughly 15 words of actual content, or contain no discernible negotiating move, this is an automatic 0.

Assess only the BUYER'S turns when deciding the technique score.

Return ONLY valid JSON with no markdown, no code fences and no explanation.

Return EXACTLY this structure:

{
  "score": 0,
  "preparation": {
    "rating": "Short overall preparation rating.",
    "covered": [],
    "missed": [],
    "nudge": "One concrete preparation improvement.",
    "planVsActual": "One short comparison between the preparation and what the buyer actually did."
  },
  "outcomeVsTarget": "Clear statement of the final commercial outcome.",
  "commercial": {
    "positives": [],
    "negatives": []
  },
  "tactics": {
    "positives": [],
    "negatives": []
  },
  "risk": [],
  "coachingTip": "One concrete thing to do differently next time."
}

OUTCOME VS TARGET:

This must be a separate assessment from the technique score.

Determine the final commercial outcome from the actual agreement in the transcript, using the buyer's preparation and session information as supporting evidence.

SOURCE OF TRUTH FOR NUMBERS:

Use the explicitly stated buyer target and walk-away from the preparation/session information when available.

Use the transcript to establish the final agreed terms and any numbers explicitly discussed.

Do not confuse a supplier's offer, the buyer's opening position, the target, and the walk-away.

Do not substitute one number for another. If conflicting figures appear, acknowledge the inconsistency rather than silently choosing one.

Keep all references to the target, walk-away and final agreed price consistent throughout the entire debrief.

PRICE DIRECTION — PROCUREMENT:
For a buyer negotiating a purchase price, a lower price is generally better.

If the walk-away is the maximum acceptable price, a final price below it is within the buyer's threshold.

If the final price equals the maximum acceptable price, the buyer has met the threshold.

If the final price exceeds the maximum acceptable price, the buyer has breached the threshold.

Never describe a price below the buyer's maximum acceptable purchase price as a breach or miss of that walk-away threshold.

If the buyer's threshold is explicitly defined differently, follow that definition.

TARGET VS WALK-AWAY:
A target and a walk-away are not necessarily the same thing. Assess the agreed price against the actual target if one is provided, and assess it separately against the walk-away. Do not call the target missed solely because the walk-away was missed, or vice versa.

Clearly state whether the outcome BEAT, MET or MISSED the target when a meaningful target is available. If only a walk-away is available, describe whether the agreed price was within or beyond that threshold instead of inventing a target.

Include the relevant numbers and units whenever available. Do not let the technique score influence this assessment.

If no target or meaningful threshold can be established, say:
"No target was available, so the final outcome could not be assessed against a specific target."

Consider the broader commercial context, such as savings against a previous contract price, scope, contract length and terms. Explain these separately from whether the agreed price met the buyer's target or walk-away. A strong saving against a previous price does not automatically mean the buyer met their target.

COMMERCIAL:

Focus on the actual commercial outcome and decisions, including price, contract terms, scope, value, target, concessions and unresolved commercial issues.

Separate genuine positives from genuine negatives.

Commercial positives should identify things the buyer actually achieved or handled well commercially.

Commercial negatives should identify genuine missed opportunities, weaknesses or unresolved commercial issues.

TACTICS:

Focus on what happened during the negotiation.

Consider questioning, anchoring, leverage, information control, concessions, supplier pressure and control of the conversation.

Separate genuine positives from genuine negatives.

Tactical positives should identify things the buyer actually did well.

Tactical negatives should identify genuine technique weaknesses or missed opportunities.

IMPORTANT — NO DUPLICATE CREDIT:

Each observation must appear in ONE category only across Commercial, Tactics and Risk.

Use COMMERCIAL for actual commercial results and terms achieved or missed: price, savings, target achievement, concessions, scope, contract terms and unresolved commercial outcomes.

Use TACTICS for how the buyer negotiated: questioning, anchoring, leverage, information control, timing, pressure handling, concession strategy and control of the conversation.

Use RISK only for ongoing exposure or potential harm, such as a weak contract protection, supplier dependency, an exposed walk-away number or unresolved legal terms.

Do not repeat the same event, number, action or conclusion in multiple categories. If an observation could fit more than one category, place it in the single most relevant category.

For example:

If the final price is below the buyer's maximum acceptable price, do not describe it as a commercial failure.

If the buyer disclosed their walk-away, discuss that disclosure as a tactical weakness OR as a future risk, not both.

Do not repeat a missed target in multiple Commercial negatives.

Do not praise the same market-price reference in both Commercial and Tactics.

Before returning the JSON, check all Commercial, Tactics and Risk items for duplication. Remove repeated observations and ensure all statements use the same agreed price, target and walk-away figures.

Keep the feedback punchy. A single event should not generate multiple pieces of praise or criticism.

RISK:

Focus only on exposure and things the buyer should be careful about.

Consider contractual or commercial risks, supplier leverage, missing information, unresolved issues and risks created by concessions or commitments.

Do NOT split risk into positives and negatives.

ABSENCE RULE:

Do not manufacture positives or negatives simply to fill a section.

If there are no genuine commercial positives, return:
["Nothing notable here."]

If there are no genuine commercial negatives, return:
["Nothing notable here."]

If there are no genuine tactical positives, return:
["Nothing notable here."]

If there are no genuine tactical negatives, return:
["Nothing notable here."]

If there is not enough negotiation content to assess a section, say so plainly rather than inventing findings.

If the score is 0, commercial, tactics and risk should clearly state that there is not enough negotiation content to assess.

Keep every item short, specific and grounded in something actually said or agreed in the transcript.

Do not praise the buyer simply for participating.

Most importantly:
A buyer can have a LOW technique score AND a GOOD commercial outcome.

Make that distinction completely clear in the debrief.
`,

                    messages: [

                        {
                            role:
                                "user",

                            content:
                                session.messages
                                    .map(
                                        m =>
                                            `${m.sender.toUpperCase()}: ${m.message}`
                                    )
                                    .join("\n\n")
                        }
                    ]
                });


            // Record API usage
            recordUsage(
                debriefResponse,
                "debrief",
                session
            );


            const debriefText =
                debriefResponse.content.find(
                    block =>
                        block.type === "text"
                );


            if (!debriefText) {

                throw new Error(
                    "Claude returned no debrief text"
                );
            }


            let debrief;


            try {

                debrief =
                    parseClaudeJson(
                        debriefText.text
                    );

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
                    error:
                        "Debrief returned invalid data"
                });
            }


            session.debrief =
                debrief;

            session.status =
                "completed";

            session.completedAt =
                new Date().toISOString();


            res.json({

                sessionId:
                    session.id,

                debrief:
                    debrief
            });


        } catch (error) {

            console.error(
                "Claude debrief error:",
                error
            );

            res.status(500).json({
                error:
                    "Debrief generation failed"
            });
        }
    }
);


// ============================================================
// USAGE / COST REPORT
// ============================================================
//
// IMPORTANT:
// This is intended for your beta/admin use.
// It is protected by ADMIN_USAGE_KEY if you set one
// in your .env file.
//
// ============================================================

router.get("/usage", (req, res) => {

    const adminKey =
        process.env.ADMIN_USAGE_KEY;


    if (adminKey) {

        const suppliedKey =
            req.headers["x-admin-key"];


        if (
            !suppliedKey ||
            suppliedKey !== adminKey
        ) {

            return res.status(401).json({
                error:
                    "Unauthorised"
            });
        }
    }


    const sessionList =
        Object.values(sessions);


    const completedSessions =
        sessionList.filter(
            session =>
                session.status === "completed"
        );


    const totalSessionCost =
        sessionList.reduce(
            (total, session) =>
                total +
                (session.usage?.costUSD || 0),
            0
        );


    const averageCostPerCompletedSession =
        completedSessions.length > 0
            ? completedSessions.reduce(
                (total, session) =>
                    total +
                    (session.usage?.costUSD || 0),
                0
            ) / completedSessions.length
            : 0;


    res.json({

        pricing: {

            model:
                "claude-sonnet-4-6",

            input:
                "$3 per million tokens",

            output:
                "$15 per million tokens"
        },


        sessions: {

            total:
                sessionList.length,

            completed:
                completedSessions.length,

            active:
                sessionList.filter(
                    session =>
                        session.status === "active"
                ).length
        },


        apiUsage: {

            totalRequests:
                usageTotals.totalRequests,

            totalInputTokens:
                usageTotals.totalInputTokens,

            totalOutputTokens:
                usageTotals.totalOutputTokens,

            totalCostUSD:
                Number(
                    usageTotals.totalCostUSD.toFixed(6)
                )
        },


        averageCostPerCompletedSessionUSD:
            Number(
                averageCostPerCompletedSession
                    .toFixed(6)
            ),


        byType:
            usageTotals.byType,


        sessions:
            sessionList.map(
                session => ({

                    id:
                        session.id,

                    scenario:
                        session.scenarioTitle,

                    status:
                        session.status,

                    startedAt:
                        session.startedAt,

                    completedAt:
                        session.completedAt || null,

                    requests:
                        session.usage?.requests || 0,

                    inputTokens:
                        session.usage?.inputTokens || 0,

                    outputTokens:
                        session.usage?.outputTokens || 0,

                    costUSD:
                        Number(
                            (
                                session.usage?.costUSD ||
                                0
                            ).toFixed(6)
                        )
                })
            )
    });
});


// ============================================================
// GET A SESSION
// ============================================================

router.get(
    "/:sessionId",
    (req, res) => {

        const {
            sessionId
        } = req.params;


        const session =
            sessions[sessionId];


        if (!session) {

            return res.status(404).json({
                error:
                    "Session not found"
            });
        }


        res.json(session);
    }
);


// ============================================================
// BUILD CASE FROM USER DESCRIPTION
// ============================================================

router.post(
    "/build-case",
    async (req, res) => {

        const {
            description
        } = req.body;


        if (
            !description ||
            !description.trim()
        ) {

            return res.status(400).json({
                error:
                    "Description is required"
            });
        }


        try {

            const response =
                await anthropic.messages.create({

                    model:
                        "claude-sonnet-4-6",

                    max_tokens:
                        500,

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
                            role:
                                "user",

                            content:
                                description.trim()
                        }
                    ]
                });


            // Record usage
            recordUsage(
                response,
                "caseBuilder"
            );


            const textBlock =
                response.content.find(
                    block =>
                        block.type === "text"
                );


            if (!textBlock) {

                throw new Error(
                    "Claude returned no text response"
                );
            }


            const parsed =
                parseClaudeJson(
                    textBlock.text
                );


            res.json(parsed);


        } catch (error) {

            console.error(
                "Case builder error:",
                error
            );

            res.status(500).json({
                error:
                    "Couldn't build the case"
            });
        }
    }
);


// ============================================================
// ANONYMIZE CASE
// ============================================================

router.post(
    "/anonymize-case",
    async (req, res) => {

        const {
            rawText,
            scenario
        } = req.body;


        if (
            !rawText ||
            !scenario
        ) {

            return res.status(400).json({
                error:
                    "Raw text and scenario are required"
            });
        }


        try {

            const response =
                await anthropic.messages.create({

                    model:
                        "claude-sonnet-4-6",

                    max_tokens:
                        500,

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
                            role:
                                "user",

                            content: `
Buyer's raw description:

${rawText}

Structured case brief:

${JSON.stringify(scenario)}
`
                        }
                    ]
                });


            // Record usage
            recordUsage(
                response,
                "anonymisation"
            );


            const textBlock =
                response.content.find(
                    block =>
                        block.type === "text"
                );


            if (!textBlock) {

                throw new Error(
                    "Claude returned no text response"
                );
            }


            const parsed =
                parseClaudeJson(
                    textBlock.text
                );


            res.json(parsed);


        } catch (error) {

            console.error(
                "Anonymisation error:",
                error
            );

            res.status(500).json({
                error:
                    "Couldn't anonymise case"
            });
        }
    }
);


module.exports = router;