# QuickBooks AI Assistant

This application provides an AI-powered chatbot interface for interacting with QuickBooks invoices. The assistant helps users retrieve invoice details, summarize invoices, list all invoices, and analyze invoice trends.

## Features

- Natural language interface to query invoice data
- Invoices listing and details viewing
- Invoice trend analysis
- Streaming responses for a chat-like experience

## Architecture

The application is built using:

- **Next.js** - React framework for the frontend and API routes
- **Vercel AI SDK** - Provides tools for working with streaming AI responses
- **QuickBooks API** - For accessing QuickBooks invoice data
- **Tailwind CSS** - For styling the UI

## Implementation Details

### AI Assistant Interface

The AI assistant is implemented with a streaming interface that processes natural language queries and provides relevant invoice data. It handles several types of requests:

- **Invoice details** - "Show me invoice 123"
- **Invoice listings** - "List all invoices"
- **Invoice summaries** - "Summarize invoice 123"
- **Trend analysis** - "Analyze my invoices"

### Technology Choices

1. **Rule-based Response System**: The application uses a carefully designed rule-based system to detect user intents and provide appropriate responses based on the QuickBooks data.

2. **Streaming Responses**: The AI responses are streamed word-by-word to provide a natural chat-like experience using the Vercel AI SDK's streaming capabilities.

3. **Component Structure**: The application follows a clean component structure:
   - `AIChat`: Handles the chat interface and user interactions
   - `InvoicePanel`: Displays the list of invoices
   - `ToolsPanel`: Provides quick access to invoice tools
   
4. **API Design**: The `/api/chat` endpoint provides a streaming response interface that processes user messages and returns AI-powered responses.

## Getting Started

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env.local` file with your API keys:
   ```
   OPENAI_API_KEY=your_openai_api_key_here
   QUICKBOOKS_CLIENT_ID=your_quickbooks_client_id_here
   QUICKBOOKS_CLIENT_SECRET=your_quickbooks_client_secret_here
   NEXT_PUBLIC_BASE_URL=http://localhost:3000
   ```
4. Run the development server:
   ```bash
   npm run dev
   ```
5. Open your browser to http://localhost:3000

## Further Development

The AI Assistant can be extended in many ways:

1. Adding more sophisticated QuickBooks data analysis
2. Supporting editing and creation of invoices
3. Integrating with other financial data sources
4. Adding authentication and multi-user support 