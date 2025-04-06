import { z } from 'zod';
import { fetchInvoices, getInvoiceById } from '../quickbooks/api';
import { Invoice } from '@/types';

const invoiceSchema = z.object({
  id: z.string(),
});

const analyzeSchema = z.object({
  analysisType: z.enum(['trends', 'customer', 'amounts']),
  timeframe: z.enum(['week', 'month', 'year']).optional(),
});

export const invoiceTools = {
  getInvoice: {
    name: 'getInvoice',
    description: 'Get details of a specific invoice by ID',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ID of the invoice to retrieve',
        },
      },
      required: ['id'],
    },
  },
  listInvoices: {
    name: 'listInvoices',
    description: 'List all invoices',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  summarizeInvoice: {
    name: 'summarizeInvoice',
    description: 'Get a natural language summary of an invoice',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ID of the invoice to summarize',
        },
      },
      required: ['id'],
    },
  },
  analyzeInvoices: {
    name: 'analyzeInvoices',
    description: 'Perform analysis of invoices',
    parameters: {
      type: 'object',
      properties: {
        analysisType: {
          type: 'string',
          enum: ['trends', 'customer', 'amounts'],
          description: 'Type of analysis to perform',
        },
        timeframe: {
          type: 'string',
          enum: ['week', 'month', 'year'],
          description: 'Time period to analyze',
        },
      },
      required: ['analysisType'],
    },
  },
};

// Update the handleToolCall function to use the consistent API endpoint
export const handleToolCall = async (tool: string, params: any) => {
  console.log(`🔧 Executing tool: ${tool} with params:`, params);
  
  try {
    // Use a single consistent API endpoint for all tool calls
    const response = await fetch('/api/chat/tool', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tool,
        params
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error(`Error calling ${tool}:`, errorData);
      throw new Error(errorData.error || `Failed to execute ${tool} tool`);
    }
    
    const data = await response.json();
    console.log(`✅ ${tool} execution result:`, data);
    
    // For summarizeInvoice, add additional formatting if needed
    if (tool === 'summarizeInvoice' && data && !data.summary && !data.details) {
      // If we just got a raw invoice, format it into a summary
      if (data.DocNumber && data.CustomerRef) {
        const invoice = data;
        return {
          summary: `Invoice #${invoice.DocNumber} for ${invoice.CustomerRef.name}`,
          details: {
            customer: invoice.CustomerRef.name,
            amount: `$${Number(invoice.TotalAmt).toFixed(2)}`,
            date: invoice.TxnDate ? new Date(invoice.TxnDate).toLocaleDateString() : 'Unknown date',
            dueDate: invoice.DueDate ? new Date(invoice.DueDate).toLocaleDateString() : 'Not specified',
            balance: `$${Number(invoice.Balance || 0).toFixed(2)}`,
            memo: invoice.CustomerMemo?.value || invoice.PrivateNote || 'No memo available'
          }
        };
      }
    }
    
    return data;
  } catch (error) {
    console.error(`Error handling tool call ${tool}:`, error);
    throw error;
  }
};

// Keeping the direct implementations as fallbacks, but they shouldn't be used anymore
export const toolImplementations = {
  getInvoice: async (params: Record<string, any>) => {
    const { id } = params;
    return await getInvoiceById(id);
  },
  
  listInvoices: async () => {
    return await fetchInvoices();
  },
  
  summarizeInvoice: async (params: Record<string, any>) => {
    const { id } = params;
    const invoice = await getInvoiceById(id);
    
    return {
      summary: `Invoice #${invoice.DocNumber} for ${invoice.CustomerRef.name}`,
      details: {
        customer: invoice.CustomerRef.name,
        amount: `$${Number(invoice.TotalAmt).toFixed(2)}`,
        date: invoice.TxnDate ? new Date(invoice.TxnDate).toLocaleDateString() : 'Unknown date',
        dueDate: invoice.DueDate ? new Date(invoice.DueDate).toLocaleDateString() : 'Not specified',
        balance: `$${Number(invoice.Balance || 0).toFixed(2)}`,
        memo: invoice.CustomerMemo?.value || invoice.PrivateNote || 'No memo available'
      }
    };
  },
  
  analyzeInvoices: async (params: Record<string, any>) => {
    const { analysisType } = params;
    const invoices = await fetchInvoices();
    
    // Basic analysis implementation
    if (analysisType === 'trends') {
      // Implementation for trends analysis
    } else if (analysisType === 'customer') {
      // Implementation for customer analysis
    } else if (analysisType === 'amounts') {
      // Implementation for amount analysis
    }
    
    return {
      analysisType,
      result: 'Analysis results would appear here',
      invoicesAnalyzed: invoices.length
    };
  }
}; 