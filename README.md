Off Book

Procurement negotiation practice, without the real-world risk.

Off Book is an AI-powered procurement negotiation training tool designed to help procurement professionals practise difficult or unfamiliar supplier negotiations.

Instead of reading a case study or following a scripted exercise, users negotiate directly with a simulated supplier and then receive a practical debrief on their negotiation technique.

How It Works
Choose a scenario
Select a procurement situation such as an IT software renewal, facilities management contract or another unfamiliar negotiation.
Negotiate with the supplier
The AI takes the role of the supplier and responds to the buyer's questions, challenges and commercial proposals.
Handle realistic supplier behaviour
The supplier is designed to protect its commercial position, resist unnecessary concessions and negotiate in return for value.
Receive a debrief
Once the negotiation is complete, Off Book analyses the conversation and provides feedback on the buyer's negotiation technique.

The debrief looks at areas such as:

Preparation
Questioning
Leverage
Information control
Handling supplier pressure
Trading concessions
Commercial clarity
Missed opportunities
Supplier negotiation tactics
Example Scenario
IT Software Renewal

An existing software supplier has proposed a significant price increase at contract renewal.

The buyer must negotiate with the supplier while considering:

Price
Contract length
Service levels
Payment terms
Supplier relationship
Alternative options
Commercial leverage

The supplier's objective is not simply to agree with the buyer. It is designed to protect its revenue and margin while trying to retain the customer.

Why Off Book?

Procurement professionals regularly encounter categories, suppliers and situations that they have limited experience with.

Off Book provides a safe environment to practise those conversations before having them in the real world.

The aim is not to teach one "correct" negotiation style. Instead, the tool is intended to help users understand how their own approach performs when faced with realistic supplier behaviour.

Current Status

Off Book is currently an early-stage prototype / beta project.

The current version includes:

Scenario selection
AI supplier simulation
Live negotiation conversations
Session management
AI-generated negotiation debriefs
Negotiation technique scoring
Supplier tactic analysis
Coaching recommendations

The immediate goal is to test the prototype with a small group of beta users and learn:

How realistic the supplier simulations feel
Whether the negotiations are enjoyable and useful
Whether the debrief provides genuinely useful feedback
Which procurement scenarios users find most valuable
The expected cost per negotiation session
What features are needed before a wider release
Technology

Off Book currently uses:

Node.js
Express.js
JavaScript
HTML / CSS
Anthropic Claude API
Git / GitHub

The application uses a Node.js backend to communicate with the AI model, keeping the API credentials server-side rather than exposing them in the browser.

Project Structure
Off-Book/
├── data/
│   └── scenarios.js
├── public/
│   └── index.html
├── routes/
│   ├── scenarios.js
│   └── sessions.js
├── server.js
├── package.json
├── Procfile
└── .gitignore
Running Locally

Clone the repository and install the dependencies:

npm install

Create a .env file in the project root:

ANTHROPIC_API_KEY=your_api_key_here

Then start the server:

node server.js

The application will be available at:

http://localhost:3000
Important

The Anthropic API key should never be committed to GitHub.

The project uses .gitignore to keep the .env file out of the repository.

Project Vision

The longer-term aim for Off Book is to become a practical negotiation practice environment where procurement professionals can rehearse challenging conversations, experiment with different approaches and receive useful feedback before facing similar situations in the real world.

Practise the conversation before you have it.

Off Book is currently a prototype and is under active development.
