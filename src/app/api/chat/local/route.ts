import { StreamingTextResponse } from 'ai';
import { fetchInvoices, fetchInvoiceById } from '@/lib/quickbooks/api';

// Local simple chatbot that doesn't rely on external APIs
export async function POST(req: Request) {
  console.log("Using local chatbot fallback");
  
  try {
    const { messages } = await req.json();
    
    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: "Invalid request: messages array is required" }),
        { status: 400 }
      );
    }
    
    // Get the last user message
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    
    // Simple response generator based on keywords in the message
    const response = await generateResponse(lastUserMessage);
    
    // Create a ReadableStream
    const stream = new ReadableStream({
      start(controller) {
        // Send response text in chunks
        const encoder = new TextEncoder();
        const text = response;
        
        // Send response in small chunks to simulate stream
        let start = 0;
        const chunkSize = 10;
        
        function sendChunk() {
          if (start < text.length) {
            const end = Math.min(start + chunkSize, text.length);
            const chunk = text.slice(start, end);
            controller.enqueue(encoder.encode(chunk));
            start = end;
            setTimeout(sendChunk, 10); // Delay between chunks
          } else {
            controller.close();
          }
        }
        
        sendChunk();
      }
    });
    
    // Return streaming response
    return new StreamingTextResponse(stream);
  } catch (error) {
    console.error("Error in local chatbot:", error);
    return new Response(
      JSON.stringify({ 
        error: "Internal server error in local chatbot", 
        details: error instanceof Error ? error.message : String(error)
      }),
      { status: 500 }
    );
  }
}

// Generate simple responses based on keywords
async function generateResponse(message: string): Promise<string> {
  const normalizedMessage = message.toLowerCase();
  
  // Check for invoice-related queries
  if (normalizedMessage.includes('list') && normalizedMessage.includes('invoice')) {
    try {
      const invoices = await fetchInvoices();
      if (Array.isArray(invoices) && invoices.length > 0) {
        return `Here are your invoices:\n\n${invoices.map(inv => 
          `- Invoice #${inv.DocNumber}: $${inv.TotalAmt} for ${inv.CustomerRef?.name || 'Unknown Customer'} (${inv.Balance > 0 ? 'Unpaid' : 'Paid'})`
        ).join('\n')}`;
      } else {
        return "I couldn't find any invoices in your QuickBooks account. Would you like me to help with something else?";
      }
    } catch (error) {
      return "I'm unable to fetch your invoices right now. This could be due to a connection issue with QuickBooks. Would you like to try again later?";
    }
  }
  
  // Check for invoice details
  const invoiceNumberMatch = normalizedMessage.match(/invoice\s+#?(\d+)|inv[.-]?(\d+)|invoice\s+number\s+#?(\d+)/i);
  if (invoiceNumberMatch) {
    const invoiceId = invoiceNumberMatch[1] || invoiceNumberMatch[2] || invoiceNumberMatch[3];
    try {
      const invoice = await fetchInvoiceById(invoiceId);
      if (invoice) {
        return `Here are the details for Invoice #${invoice.DocNumber}:\n\n` +
          `Customer: ${invoice.CustomerRef?.name || 'Unknown'}\n` +
          `Amount: $${invoice.TotalAmt}\n` +
          `Date: ${new Date(invoice.TxnDate).toLocaleDateString()}\n` +
          `Status: ${invoice.Balance > 0 ? `Unpaid (Balance: $${invoice.Balance})` : 'Paid'}`;
      } else {
        return `I couldn't find an invoice with the number ${invoiceId}. Please check the number and try again.`;
      }
    } catch (error) {
      return `I'm having trouble retrieving information for invoice #${invoiceId}. This might be due to a connection issue with QuickBooks.`;
    }
  }
  
  // Basic greeting detection
  if (normalizedMessage.includes('hello') || normalizedMessage.includes('hi ') || normalizedMessage === 'hi') {
    return "Hello! I'm your local invoice assistant. How can I help you with your invoices today?";
  }
  
  // Help request
  if (normalizedMessage.includes('help') || normalizedMessage.includes('what can you do')) {
    return "I can help with basic invoice questions. Here are some things you can ask me:\n\n" +
      "- List my invoices\n" +
      "- Show details for invoice #1001\n" +
      "- When was invoice #1002 created?\n" +
      "- How much was invoice #1003 for?\n\n" +
      "Please note that I'm a local assistant with limited functionality compared to the AI version.";
  }
  
  // Response for thanks
  if (normalizedMessage.includes('thank')) {
    return "You're welcome! Let me know if you need anything else about your invoices.";
  }
  
  // Fallback
  return "I'm your local invoice assistant. I can help with basic questions about your invoices. For more complex queries, you might need to try again when the AI service is available.";
} 