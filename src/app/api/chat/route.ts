import { StreamingTextResponse } from 'ai'
import OpenAI from 'openai'
import { fetchInvoices, getInvoiceById, fetchInvoicesMicroMethod } from '@/lib/quickbooks/api'
import { Invoice } from '@/types'

// Initialize with proper error handling
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
})

// Verify OpenAI API key is set
const isConfigured = !!process.env.OPENAI_API_KEY

// For better debugging
const DEBUG = true
const log = (...args: any[]) => {
  if (DEBUG) {
    console.error("[OpenAI API]", ...args)
  }
}

// Allow streaming responses up to 30 seconds
export const maxDuration = 30

// Add fallback mock data in case of errors
const MOCK_INVOICES = [
  {
    Id: 'mock-001',
    DocNumber: 'INV-001',
    CustomerRef: { name: 'Sample Customer' },
    TotalAmt: 1250.00,
    TxnDate: '2023-10-15',
    Balance: 1250.00
  },
  {
    Id: 'mock-002',
    DocNumber: 'INV-002',
    CustomerRef: { name: 'Another Client' },
    TotalAmt: 3500.00,
    TxnDate: '2023-10-20',
    Balance: 0
  }
]

// Define the actions handlers
const actions = {
  getInvoice: async (id: string) => {
    try {
      console.error(`⭐ Chat API: Fetching invoice ${id} from unified source`);
      
      // Use the unified chat/tool API instead of direct access
      const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/chat/tool`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tool: 'getInvoice',
          params: { id }
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch invoice: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.error) {
        throw new Error(result.error);
      }
      
      return result;
    } catch (error) {
      console.error(`⭐ Chat API: Error fetching invoice ${id}:`, error);
      throw error;
    }
  },
  
  listInvoices: async () => {
    try {
      log('Fetching all invoices')
      const invoices = await fetchInvoices()
      return invoices
    } catch (error) {
      log('Error fetching invoices:', error)
      return { error: 'Failed to fetch invoices' }
    }
  },
  
  summarizeInvoice: async (id: string) => {
    try {
      console.error(`⭐ Chat API: Summarizing invoice ${id} using unified source`);
      
      // Use the unified chat/tool API instead of direct access
      const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/chat/tool`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tool: 'summarizeInvoice',
          params: { id }
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to summarize invoice: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.error) {
        throw new Error(result.error);
      }
      
      return result;
    } catch (error) {
      console.error(`⭐ Chat API: Error summarizing invoice ${id}:`, error);
      throw new Error(`Failed to summarize invoice: ${error.message || error}`);
    }
  },
  
  analyzeInvoices: async (analysisType: 'trends' | 'customer' | 'amounts') => {
    try {
      console.error(`⭐ Chat API: Attempting to analyze invoices by ${analysisType}`)
      
      // Try to get invoices with the micro method first
      let invoices
      try {
        invoices = await fetchInvoicesMicroMethod()
        if (!Array.isArray(invoices) || invoices.length === 0) {
          console.error('⭐ Chat API: Micro method returned no invoices for analysis, trying standard method')
          invoices = await fetchInvoices()
        }
      } catch (error) {
        console.error('⭐ Chat API: Micro method failed for analysis, trying standard method:', error)
        invoices = await fetchInvoices()
      }
      
      // If we still don't have valid invoices, use mock data
      if (!Array.isArray(invoices) || invoices.length === 0) {
        console.error('⭐ Chat API: No invoices available for analysis, using mock data')
        invoices = MOCK_INVOICES
      }
      
      console.error(`⭐ Chat API: Analyzing ${invoices.length} invoices by ${analysisType}`)
      
      switch (analysisType) {
        case 'trends': {
          const byDate = invoices.reduce((acc, inv) => {
            const date = inv.TxnDate ? new Date(inv.TxnDate).toLocaleDateString() : 'Unknown'
            acc[date] = (acc[date] || 0) + (inv.TotalAmt || 0)
            return acc
          }, {} as Record<string, number>)
          return { type: 'trends', data: byDate }
        }
        case 'customer': {
          const byCustomer = invoices.reduce((acc, inv) => {
            const customer = inv.CustomerRef?.name || 'Unknown'
            acc[customer] = (acc[customer] || 0) + (inv.TotalAmt || 0)
            return acc
          }, {} as Record<string, number>)
          return { type: 'customer', data: byCustomer }
        }
        case 'amounts': {
          const total = invoices.reduce((sum, inv) => sum + (inv.TotalAmt || 0), 0)
          const average = invoices.length > 0 ? total / invoices.length : 0
          return {
            type: 'amounts',
            data: {
              total,
              average,
              count: invoices.length,
              usedMockData: invoices === MOCK_INVOICES
            },
          }
        }
        default:
          return { error: 'Invalid analysis type' }
      }
    } catch (error) {
      console.error('⭐ Chat API: Error analyzing invoices:', error)
      
      // Return mock analysis results
      return { 
        error: 'Failed to analyze real invoices. Using sample data instead.',
        type: analysisType,
        data: analysisType === 'trends' 
          ? { 'Jan 15, 2023': 1250, 'Jan 20, 2023': 3500 }
          : analysisType === 'customer'
            ? { 'Sample Customer': 1250, 'Another Client': 3500 }
            : { total: 4750, average: 2375, count: 2, usedMockData: true },
        isMock: true
      }
    }
  }
}

// Define a type for tool calls
interface ToolCall {
  name: string
  arguments: string
}

// Define a type for our custom stream data
interface ToolData {
  toolCall?: ToolCall
  toolResult?: any
}

// Simple API endpoint that redirects to Groq if OpenAI key is not configured
export async function POST(req: Request) {
  console.error("[OpenAI Fallback] Request received");
  
  // Check if OpenAI API key exists
  if (!process.env.OPENAI_API_KEY) {
    console.error("[OpenAI Fallback] No API key, suggesting to use Groq instead");
    
    // Redirect to Groq endpoint
    return new Response(
      JSON.stringify({
        error: "OpenAI API key not configured, but Groq is available. Please use the Groq provider instead.",
        useGroq: true
      }),
      { 
        status: 307, // Temporary Redirect
        headers: {
          'Content-Type': 'application/json',
          'Location': '/api/chat/groq'
        }
      }
    );
  }
  
  // If we reach here, something is wrong (as you mentioned not wanting to use OpenAI)
  return new Response(
    JSON.stringify({
      error: "OpenAI API is not enabled for this application. Please use the Groq provider instead.",
      useGroq: true
    }),
    { 
      status: 400, 
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

// Helper function to convert OpenAI's stream format to Stream format for AI SDK
function OpenAIStream(response: any, options?: any) {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  
  return new ReadableStream({
    async start(controller) {
      let functionCallBuffer = ''
      let currentFunctionCall: ToolCall | null = null
      
      try {
        for await (const chunk of response) {
          const content = chunk.choices[0]?.delta?.content
          
          if (content) {
            controller.enqueue(encoder.encode(content))
          }
          
          // Handle function calls
          if (chunk.choices[0]?.delta?.function_call) {
            if (chunk.choices[0].delta.function_call.name) {
              currentFunctionCall = {
                name: chunk.choices[0].delta.function_call.name,
                arguments: '',
              }
            }
            
            if (chunk.choices[0].delta.function_call.arguments) {
              functionCallBuffer += chunk.choices[0].delta.function_call.arguments
              if (currentFunctionCall) {
                currentFunctionCall.arguments = functionCallBuffer
              }
            }
          }
          
          // If the chunk indicates we're done or we've reached the end
          if (chunk.choices[0]?.finish_reason === 'function_call' && currentFunctionCall) {
            try {
              // Parse arguments as JSON
              const args = JSON.parse(functionCallBuffer)
              if (currentFunctionCall) {
                currentFunctionCall.arguments = JSON.stringify(args)
              }
              
              // Call the onFunctionCall handler if provided
              if (options?.experimental_onFunctionCall) {
                const newMessages = await options.experimental_onFunctionCall(currentFunctionCall)
                
                // If the handler returns new messages, add them to the context
                if (newMessages?.messages) {
                  for (const message of newMessages.messages) {
                    if (message.content) {
                      controller.enqueue(encoder.encode(message.content))
                    }
                  }
                }
              }
              
              // Reset for next function call
              functionCallBuffer = ''
              currentFunctionCall = null
            } catch (error) {
              console.error('Error parsing function call arguments:', error)
            }
          }
        }
        
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    }
  })
} 