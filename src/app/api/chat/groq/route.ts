import { StreamingTextResponse } from 'ai';
import OpenAI from 'openai';
import { 
  fetchInvoices,
  fetchInvoiceById, 
  fetchInvoicesDirectly, 
  fetchInvoicesMicroMethod,
} from '@/lib/quickbooks/api';

// Enable debug logging
const DEBUG = true;
const log = (...args: any[]) => {
  if (DEBUG) {
    console.error("[GROQ API]", ...args);
  }
};

// Initialize OpenAI client as a fallback mechanism
const groqClient = new OpenAI({
  apiKey: process.env.GROQ_API_KEY || '',
  baseURL: 'https://api.groq.com/openai/v1',
  timeout: 90000, // 90 second timeout
});

// Function to create a raw fetch request to Groq for more control
async function fetchGroqCompletion(messages) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('Missing GROQ_API_KEY');
  
  // Pre-process all user messages to check for invoice queries
  let invoiceDataAdded = false;
  const modifiedMessages = [...messages];
  
  // First, check if the last message contains an invoice reference
  if (modifiedMessages.length > 0 && modifiedMessages[modifiedMessages.length - 1].role === 'user') {
    const lastUserMessage = modifiedMessages[modifiedMessages.length - 1].content;
    
    // Check for invoice number patterns
    const invoiceNumberMatch = lastUserMessage.match(/\b(?:invoice|inv)[\s\-_#]*(\d+)\b/i);
    
    if (invoiceNumberMatch && invoiceNumberMatch[1]) {
      const invoiceNumber = invoiceNumberMatch[1];
      log(`User asked about invoice ${invoiceNumber}, fetching details using consistent source...`);
      
      try {
        // Use the unified chat/tool API to get consistent data
        const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/chat/tool`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tool: 'summarizeInvoice',
            params: { id: invoiceNumber }
          }),
        });
        
        if (!response.ok) {
          log(`Error fetching invoice with unified API: ${response.statusText}`);
          return;
        }
        
        const result = await response.json();
        
        // Check if we got a valid result with summary details
        if (result && result.summary && result.details) {
          // Use the consistent formatted data for the AI
          const formattedInvoiceData = {
            invoiceNumber: invoiceNumber,
            customerName: result.details.customer,
            amount: result.details.amount,
            date: result.details.date,
            dueDate: result.details.dueDate,
            status: result.details.balance === '$0.00' ? "Paid" : "Unpaid",
            balance: result.details.balance,
          };
          
          // Add detailed invoice information first in the conversation
          modifiedMessages.unshift({
            role: 'system',
            content: `IMPORTANT: The user is asking about invoice #${invoiceNumber}. Here's the exact information to use:

Invoice #${formattedInvoiceData.invoiceNumber}
Customer: ${formattedInvoiceData.customerName}
Amount: ${formattedInvoiceData.amount}
Date: ${formattedInvoiceData.date}
Due Date: ${formattedInvoiceData.dueDate}
Status: ${formattedInvoiceData.status}
${formattedInvoiceData.status !== "Paid" ? `Balance Due: ${formattedInvoiceData.balance}` : ""}

DO NOT add any extra formatting. DO NOT use markdown. DO NOT add line breaks within fields. Present this information exactly as shown above, keeping this exact format and spacing. Make sure each field is on its own line. This is critical for proper display.`
          });
          
          invoiceDataAdded = true;
          log('Successfully added formatted invoice data to the context using unified source');
        } else {
          log('Invalid or incomplete data from unified API', result);
        }
      } catch (error) {
        log(`Failed to fetch invoice ${invoiceNumber} from unified source:`, error);
      }
    }
  }
  
  // Then add a more specific system prompt if we added invoice data
  const systemPrompt = invoiceDataAdded ? 
    `You are an AI assistant for QuickBooks invoice management. When presenting invoice information:

1. CRITICAL: Present the invoice information EXACTLY as provided to you, keeping the same format, spacing, and line breaks. Do not rearrange or reformat the information.

2. Do not use any special formatting, markdown, or symbols like asterisks (*).

3. Each field must be on its own line with proper spacing.

4. Respond in plain text only.

5. If the user asks any follow-up questions about the invoice, use the exact data provided to you.

6. DO NOT provide any additional information or interpret the invoice data - use ONLY the exact values provided to you.` :
    `You are an AI assistant focused on invoice management and QuickBooks data analysis. Follow these instructions exactly:

1. When showing invoice information, use ONLY this exact format with each field on its own line:
   Invoice #[Number]
   [Status]
   
   Customer
   [Name]
   
   Amount
   $[Amount]
   
   Balance Due
   $[Balance]
   
   Date
   [Date]
   
   Due Date
   [Due Date]
   
   Memo
   [Memo Text]

2. Do not deviate from this exact format for invoice displays.

3. For ALL responses:
   - Use plain text only
   - No markdown or special formatting
   - No asterisks (*) or other symbols
   - No extra line breaks within fields
   - Keep proper spacing between fields

4. Format all currency values with dollar signs and two decimal places: $1,234.56`;

  const body = JSON.stringify({
    model: 'llama3-70b-8192',
    messages: [
      {
        role: 'system',
        content: systemPrompt
      },
      ...modifiedMessages
    ],
    temperature: 0.3, // Very low temperature for predictable formatting
    max_tokens: 800,
    stream: true,
  });
  
  log('Making request to Groq');
  
  return fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body,
  });
}

// Set maximum duration for streaming responses
const MAX_STREAMING_DURATION = 30000; // 30 seconds

// Add actions to handle invoice operations
const actions = {
  // Fetch invoice by ID with enhanced error handling
  getInvoice: async (id) => {
    try {
      log(`Fetching invoice ${id}`);
      
      // Try multiple methods to get the invoice
      let invoice = null;
      let errors = [];
      
      // Try fetchInvoiceById first
      try {
        invoice = await fetchInvoiceById(id);
        if (invoice) return invoice;
      } catch (error) {
        log(`Error with fetchInvoiceById for ${id}:`, error);
        errors.push(`fetchInvoiceById: ${error.message || error}`);
      }
      
      // If that fails, try getting all invoices and filtering
      if (!invoice) {
        try {
          const allInvoices = await fetchInvoices();
          if (Array.isArray(allInvoices)) {
            // Look for invoice by Id or DocNumber
            invoice = allInvoices.find(inv => 
              inv.Id === id || 
              inv.DocNumber === id ||
              (inv.Id && inv.Id.toString() === id.toString()) ||
              (inv.DocNumber && inv.DocNumber.toString() === id.toString())
            );
            if (invoice) return invoice;
          }
        } catch (error) {
          log(`Error finding invoice ${id} in all invoices:`, error);
          errors.push(`fetchInvoices: ${error.message || error}`);
        }
      }
      
      // If still no invoice found, try direct method
      if (!invoice) {
        try {
          const allInvoices = await fetchInvoicesDirectly();
          if (Array.isArray(allInvoices)) {
            invoice = allInvoices.find(inv => 
              inv.Id === id || 
              inv.DocNumber === id ||
              (inv.Id && inv.Id.toString() === id.toString()) ||
              (inv.DocNumber && inv.DocNumber.toString() === id.toString())
            );
            if (invoice) return invoice;
          }
        } catch (error) {
          log(`Error with direct method for ${id}:`, error);
          errors.push(`direct: ${error.message || error}`);
        }
      }
      
      // Finally, try micro method
      if (!invoice) {
        try {
          const allInvoices = await fetchInvoicesMicroMethod();
          if (Array.isArray(allInvoices)) {
            invoice = allInvoices.find(inv => 
              inv.Id === id || 
              inv.DocNumber === id ||
              (inv.Id && inv.Id.toString() === id.toString()) ||
              (inv.DocNumber && inv.DocNumber.toString() === id.toString())
            );
            if (invoice) return invoice;
          }
        } catch (error) {
          log(`Error with micro method for ${id}:`, error);
          errors.push(`micro: ${error.message || error}`);
        }
      }
      
      if (!invoice) {
        return { 
          error: `Invoice ${id} not found. Tried multiple methods.`,
          errors: errors,
          suggestedActions: ["Try a different invoice number", "Check if QuickBooks is connected"]
        };
      }
      
      return invoice;
    } catch (error) {
      log(`Error in getInvoice(${id}):`, error);
      return { 
        error: `Failed to fetch invoice ${id}: ${error.message || error}`,
        suggestedActions: ["Try again later", "Check your QuickBooks connection"]
      };
    }
  },
  
  // List all invoices
  listInvoices: async () => {
    try {
      log('Fetching all invoices');
      
      // Try multiple methods to get invoices
      let invoices = null;
      let errors = [];
      
      // Try standard method first
      try {
        invoices = await fetchInvoices();
        if (invoices && Array.isArray(invoices) && invoices.length > 0) {
          return invoices;
        }
      } catch (error) {
        log('Error with standard method:', error);
        errors.push(`standard: ${error.message || error}`);
      }
      
      // Try direct method
      if (!invoices || !Array.isArray(invoices) || invoices.length === 0) {
        try {
          invoices = await fetchInvoicesDirectly();
          if (invoices && Array.isArray(invoices) && invoices.length > 0) {
            return invoices;
          }
        } catch (error) {
          log('Error with direct method:', error);
          errors.push(`direct: ${error.message || error}`);
        }
      }
      
      // Try micro method
      if (!invoices || !Array.isArray(invoices) || invoices.length === 0) {
        try {
          invoices = await fetchInvoicesMicroMethod();
          if (invoices && Array.isArray(invoices) && invoices.length > 0) {
            return invoices;
          }
        } catch (error) {
          log('Error with micro method:', error);
          errors.push(`micro: ${error.message || error}`);
        }
      }
      
      if (!invoices || !Array.isArray(invoices) || invoices.length === 0) {
        return { 
          error: 'No invoices found. Tried multiple methods.',
          errors: errors,
          invoices: []
        };
      }
      
      return invoices;
    } catch (error) {
      log('Error fetching invoices:', error);
      return { 
        error: `Failed to fetch invoices: ${error.message || error}`,
        invoices: []
      };
    }
  },

  // Summarize invoice by ID
  summarizeInvoice: async ({ id }: { id: string }) => {
    console.log(`Summarizing invoice: ${id}`);
    try {
      const invoice = await actions.getInvoice(id);
      
      if (!invoice || invoice.error) {
        return {
          success: false,
          error: invoice.error || "Invoice not found",
        };
      }

      return {
        success: true,
        summary: {
          invoiceNumber: invoice.DocNumber,
          customer: invoice.CustomerRef?.name || "Unknown Customer",
          amount: invoice.TotalAmt,
          date: invoice.TxnDate,
          status: invoice.Balance > 0 ? "Unpaid" : "Paid",
          balance: invoice.Balance
        }
      };
    } catch (error) {
      console.error("Error summarizing invoice:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  // Analyze invoices (trends, customer, amounts etc.)
  analyzeInvoices: async ({ type }: { type: 'trends' | 'customer' | 'amounts' }) => {
    console.log(`Analyzing invoices (${type})`);
    try {
      let invoices;
      
      try {
        // Try to get real invoices first
        invoices = await fetchInvoices();
      } catch (error) {
        // Try direct method
        try {
          invoices = await fetchInvoicesDirectly();
        } catch (directError) {
          // Try micro method
          try {
            invoices = await fetchInvoicesMicroMethod();
          } catch (microError) {
            // If all methods fail, return error
            return {
              success: false,
              error: "Could not fetch invoices for analysis. Please check your QuickBooks connection."
            };
          }
        }
      }

      // If no valid invoices were found or fetched, return error
      if (!invoices || !Array.isArray(invoices) || invoices.length === 0) {
        return {
          success: false,
          error: "No invoices found for analysis."
        };
      }

      // Perform analysis based on type
      let analysis;
      
      switch (type) {
        case 'trends':
          // Group invoices by month
          const byMonth = invoices.reduce((acc, inv) => {
            const date = new Date(inv.TxnDate);
            const monthYear = `${date.getFullYear()}-${date.getMonth() + 1}`;
            
            if (!acc[monthYear]) acc[monthYear] = { total: 0, count: 0 };
            
            acc[monthYear].total += inv.TotalAmt;
            acc[monthYear].count += 1;
            
            return acc;
          }, {} as Record<string, { total: number, count: number }>);
          
          analysis = {
            byMonth,
            totalInvoiced: invoices.reduce((sum, inv) => sum + inv.TotalAmt, 0),
            averageInvoiceAmount: invoices.reduce((sum, inv) => sum + inv.TotalAmt, 0) / invoices.length,
            unpaidTotal: invoices.reduce((sum, inv) => sum + (inv.Balance || 0), 0)
          };
          break;
          
        case 'customer':
          // Group invoices by customer
          const byCustomer = invoices.reduce((acc, inv) => {
            const customerName = inv.CustomerRef?.name || 'Unknown';
            
            if (!acc[customerName]) acc[customerName] = { 
              total: 0, 
              count: 0, 
              unpaid: 0,
              averageAmount: 0,
              invoices: []
            };
            
            acc[customerName].total += inv.TotalAmt;
            acc[customerName].count += 1;
            acc[customerName].unpaid += (inv.Balance || 0);
            acc[customerName].invoices.push({
              id: inv.Id,
              number: inv.DocNumber,
              amount: inv.TotalAmt,
              balance: inv.Balance,
              date: inv.TxnDate
            });
            
            return acc;
          }, {} as Record<string, any>);
          
          // Calculate averages
          Object.keys(byCustomer).forEach(customer => {
            byCustomer[customer].averageAmount = byCustomer[customer].total / byCustomer[customer].count;
          });
          
          analysis = { byCustomer };
          break;
          
        case 'amounts':
          // Analyze amounts
          analysis = {
            highest: invoices.reduce((max, inv) => inv.TotalAmt > max.amount ? { 
              amount: inv.TotalAmt, 
              invoice: inv.DocNumber, 
              id: inv.Id 
            } : max, { amount: 0, invoice: '', id: '' }),
            lowest: invoices.reduce((min, inv) => 
              (min.amount === 0 || inv.TotalAmt < min.amount) ? { 
                amount: inv.TotalAmt, 
                invoice: inv.DocNumber, 
                id: inv.Id 
              } : min, { amount: 0, invoice: '', id: '' }),
            average: invoices.reduce((sum, inv) => sum + inv.TotalAmt, 0) / invoices.length,
            total: invoices.reduce((sum, inv) => sum + inv.TotalAmt, 0),
            unpaidTotal: invoices.reduce((sum, inv) => sum + (inv.Balance || 0), 0),
            fullyPaid: invoices.filter(inv => inv.Balance === 0).length,
            partiallyPaid: invoices.filter(inv => inv.Balance > 0 && inv.Balance < inv.TotalAmt).length,
            unpaid: invoices.filter(inv => inv.Balance === inv.TotalAmt).length
          };
          break;
          
        default:
          analysis = { error: "Invalid analysis type" };
      }
      
      return {
        success: true,
        analysisType: type,
        analysis,
      };
      
    } catch (error) {
      console.error(`Error analyzing invoices (${type}):`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
};

export async function POST(req: Request) {
  log("Received request to Groq API");
  
  // Verify that we have a Groq API Key
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    log("Missing Groq API key");
    return new Response(
      JSON.stringify({
        error: "Missing Groq API key. Please add GROQ_API_KEY to your .env.local file."
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
  
  try {
    // Parse the request
    const body = await req.json();
    const { messages } = body;
    
    if (!messages || !Array.isArray(messages)) {
      log("Invalid request: missing or invalid messages array");
      return new Response(
        JSON.stringify({
          error: "Invalid request: messages array is required"
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Log the messages for debugging
    log(`Processing ${messages.length} messages`);
    
    try {
      // Try using direct fetch first for more control
      const response = await fetchGroqCompletion(messages);
      
      if (!response.ok) {
        const errorText = await response.text();
        log(`Error from Groq API: ${response.status} ${response.statusText}`, errorText);
        throw new Error(`Groq API returned status ${response.status}: ${errorText}`);
      }
      
      log("Got successful response from Groq");
      
      // Create a transformer to extract just the content from the Groq stream
      const transformStream = new TransformStream({
        start(controller) {
          log("Starting stream transformation");
          // Store partial chunks that might be split across boundaries
          this.buffer = '';
        },
        async transform(chunk, controller) {
          // Parse the chunk text
          const text = new TextDecoder().decode(chunk);
          this.buffer += text;
          
          // Process complete data: lines from the buffer
          const lines = this.buffer.split('\n');
          // Keep the last line which might be incomplete
          this.buffer = lines.pop() || '';
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                // Remove the 'data: ' prefix
                const jsonStr = line.substring(6);
                
                // Skip empty data lines or [DONE] messages
                if (jsonStr.trim() === '' || jsonStr.trim() === '[DONE]') {
                  continue;
                }
                
                // Parse the JSON
                const json = JSON.parse(jsonStr);
                
                // Extract just the content delta if it exists
                if (json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content) {
                  const content = json.choices[0].delta.content;
                  // Remove any slashes that might be used as escapes in the string
                  const cleanContent = content.replace(/\\+/g, '');
                  controller.enqueue(new TextEncoder().encode(cleanContent));
                }
              } catch (e) {
                // Log parsing errors but don't break the stream
                log("Error parsing JSON from stream:", e, "Raw text:", line);
                
                // Try more resilient approaches to extract content
                try {
                  // First try: Extract content from quoted JSON
                  const contentMatch = line.match(/"content":"([^"]*?)"/);
                  if (contentMatch && contentMatch[1]) {
                    const cleanContent = contentMatch[1].replace(/\\+/g, '');
                    controller.enqueue(new TextEncoder().encode(cleanContent));
                    continue;
                  }
                  
                  // Second try: If it looks like raw content (not JSON)
                  if (!line.includes('{') && !line.includes('}') && line.length > 7) {
                    const cleanContent = line.substring(6).replace(/\\+/g, '');
                    controller.enqueue(new TextEncoder().encode(cleanContent));
                  }
                } catch (regexError) {
                  log("Failed to extract content via alternative methods:", regexError);
                }
              }
            }
          }
        },
        flush(controller) {
          // Process any remaining data in the buffer
          if (this.buffer.startsWith('data: ')) {
            try {
              const jsonStr = this.buffer.substring(6);
              if (jsonStr.trim() !== '' && jsonStr.trim() !== '[DONE]') {
                const json = JSON.parse(jsonStr);
                if (json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content) {
                  const content = json.choices[0].delta.content;
                  const cleanContent = content.replace(/\\+/g, '');
                  controller.enqueue(new TextEncoder().encode(cleanContent));
                }
              }
            } catch (e) {
              // Try the alternative extraction methods
              const contentMatch = this.buffer.match(/"content":"([^"]*?)"/);
              if (contentMatch && contentMatch[1]) {
                const cleanContent = contentMatch[1].replace(/\\+/g, '');
                controller.enqueue(new TextEncoder().encode(cleanContent));
              }
            }
          }
        }
      });
      
      // Use the transformed stream instead of the raw response
      const transformedStream = response.body.pipeThrough(transformStream);
      
      // Return the streaming response with transformed stream
      return new StreamingTextResponse(transformedStream);
    } catch (directError) {
      log("Direct fetch to Groq failed, falling back to SDK:", directError);
      
      // Fallback to OpenAI SDK
      const response = await groqClient.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: invoiceDataAdded ? 
            `You are an AI assistant for QuickBooks invoice management. When presenting invoice information:

1. CRITICAL: Present the invoice information EXACTLY as provided to you, keeping the same format, spacing, and line breaks. Do not rearrange or reformat the information.

2. Do not use any special formatting, markdown, or symbols like asterisks (*).

3. Each field must be on its own line with proper spacing.

4. Respond in plain text only.

5. If the user asks any follow-up questions about the invoice, use the exact data provided to you.` :
            `You are an AI assistant focused on invoice management and QuickBooks data analysis. Follow these instructions exactly:

1. When showing invoice information, use ONLY this exact format with each field on its own line:
   Invoice #[Number]
   [Status]
   
   Customer
   [Name]
   
   Amount
   $[Amount]
   
   Balance Due
   $[Balance]
   
   Date
   [Date]
   
   Due Date
   [Due Date]
   
   Memo
   [Memo Text]

2. Do not deviate from this exact format for invoice displays.

3. For ALL responses:
   - Use plain text only
   - No markdown or special formatting
   - No asterisks (*) or other symbols
   - No extra line breaks within fields
   - Keep proper spacing between fields

4. Format all currency values with dollar signs and two decimal places: $1,234.56`
          }
        ],
        temperature: 0.3, // Very low temperature for predictable formatting
        max_tokens: 800,
        stream: true,
      });
      
      // Create a transformer to extract just the content from the Groq stream
      const groqTransformStream = response.body.pipeThrough(new TransformStream({
        start(controller) {
          log("Starting stream transformation");
          // Store partial chunks that might be split across boundaries
          this.buffer = '';
        },
        async transform(chunk, controller) {
          // Parse the chunk text
          const text = new TextDecoder().decode(chunk);
          this.buffer += text;
          
          // Process complete data: lines from the buffer
          const lines = this.buffer.split('\n');
          // Keep the last line which might be incomplete
          this.buffer = lines.pop() || '';
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                // Remove the 'data: ' prefix
                const jsonStr = line.substring(6);
                
                // Skip empty data lines or [DONE] messages
                if (jsonStr.trim() === '' || jsonStr.trim() === '[DONE]') {
                  continue;
                }
                
                // Parse the JSON
                const json = JSON.parse(jsonStr);
                
                // Extract just the content delta if it exists
                if (json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content) {
                  const content = json.choices[0].delta.content;
                  // Remove any slashes that might be used as escapes in the string
                  const cleanContent = content.replace(/\\+/g, '');
                  controller.enqueue(new TextEncoder().encode(cleanContent));
                }
              } catch (e) {
                // Log parsing errors but don't break the stream
                log("Error parsing JSON from stream:", e, "Raw text:", line);
                
                // Try more resilient approaches to extract content
                try {
                  // First try: Extract content from quoted JSON
                  const contentMatch = line.match(/"content":"([^"]*?)"/);
                  if (contentMatch && contentMatch[1]) {
                    const cleanContent = contentMatch[1].replace(/\\+/g, '');
                    controller.enqueue(new TextEncoder().encode(cleanContent));
                    continue;
                  }
                  
                  // Second try: If it looks like raw content (not JSON)
                  if (!line.includes('{') && !line.includes('}') && line.length > 7) {
                    const cleanContent = line.substring(6).replace(/\\+/g, '');
                    controller.enqueue(new TextEncoder().encode(cleanContent));
                  }
                } catch (regexError) {
                  log("Failed to extract content via alternative methods:", regexError);
                }
              }
            }
          }
        },
        flush(controller) {
          // Process any remaining data in the buffer
          if (this.buffer.startsWith('data: ')) {
            try {
              const jsonStr = this.buffer.substring(6);
              if (jsonStr.trim() !== '' && jsonStr.trim() !== '[DONE]') {
                const json = JSON.parse(jsonStr);
                if (json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content) {
                  const content = json.choices[0].delta.content;
                  const cleanContent = content.replace(/\\+/g, '');
                  controller.enqueue(new TextEncoder().encode(cleanContent));
                }
              }
            } catch (e) {
              // Try the alternative extraction methods
              const contentMatch = this.buffer.match(/"content":"([^"]*?)"/);
              if (contentMatch && contentMatch[1]) {
                const cleanContent = contentMatch[1].replace(/\\+/g, '');
                controller.enqueue(new TextEncoder().encode(cleanContent));
              }
            }
          }
        }
      }));
      
      // Use the transformed stream instead of the raw response
      const transformedStream = groqTransformStream;
      
      // Return the streaming response with transformed stream
      return new StreamingTextResponse(transformedStream);
    }
  } catch (error) {
    log("Error processing request:", error);
    return new Response(
      JSON.stringify({
        error: "An error occurred while processing the request. Please try again later."
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}