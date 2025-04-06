import { NextResponse } from 'next/server';
import { 
  fetchInvoices, 
  fetchInvoiceById, 
  fetchInvoicesMicroMethod
} from '@/lib/quickbooks/api';

// Enable debug logging
const DEBUG = true;
const log = (...args: any[]) => {
  if (DEBUG) {
    console.error("[CHAT TOOL API]", ...args);
  }
};

// Actions that can be executed
const actions = {
  // Fetch invoice by ID with enhanced error handling
  getInvoice: async (id: string) => {
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
        errors.push(`fetchInvoiceById: ${error instanceof Error ? error.message : String(error)}`);
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
          errors.push(`fetchInvoices: ${error instanceof Error ? error.message : String(error)}`);
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
          errors.push(`micro: ${error instanceof Error ? error.message : String(error)}`);
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
        error: `Failed to fetch invoice ${id}: ${error instanceof Error ? error.message : String(error)}`,
        suggestedActions: ["Try again later", "Check your QuickBooks connection"]
      };
    }
  },
  
  // List all invoices
  listInvoices: async () => {
    try {
      log('Fetching all invoices');
      
      // Try standard method for best reliability
      try {
        const invoices = await fetchInvoices();
        if (invoices && Array.isArray(invoices) && invoices.length > 0) {
          return invoices;
        }
      } catch (error) {
        log('Error with standard method:', error);
      }
      
      // Try micro method as fallback
      try {
        const invoices = await fetchInvoicesMicroMethod();
        if (invoices && Array.isArray(invoices) && invoices.length > 0) {
          return invoices;
        }
      } catch (error) {
        log('Error with micro method:', error);
      }
      
      // No invoices found
      return { 
        error: 'No invoices found in your QuickBooks account',
        invoices: []
      };
    } catch (error) {
      log('Error fetching invoices:', error);
      return { 
        error: `Failed to fetch invoices: ${error instanceof Error ? error.message : String(error)}`,
        invoices: []
      };
    }
  },
  
  // Summarize an invoice
  summarizeInvoice: async (params: any) => {
    try {
      const id = params.id;
      log(`Summarizing invoice ${id}`);
      
      // Get the invoice data first
      const invoice = await actions.getInvoice(id);
      
      // Check if we got an error
      if (invoice && invoice.error) {
        return invoice; // Pass through the error
      }
      
      // Format the invoice into a nice summary
      const formatCurrency = (amount: number | string) => {
        if (amount === undefined || amount === null) return '$0.00';
        const numericAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
        return numericAmount ? `$${numericAmount.toFixed(2)}` : '$0.00';
      };

      const formatDate = (dateStr: string) => {
        if (!dateStr) return 'Unknown';
        try {
          return new Date(dateStr).toLocaleDateString();
        } catch (e) {
          return dateStr;
        }
      };
      
      return {
        summary: `Invoice #${invoice.DocNumber} for ${invoice.CustomerRef?.name || 'Unknown Customer'}`,
        details: {
          customer: invoice.CustomerRef?.name || 'Unknown Customer',
          amount: formatCurrency(invoice.TotalAmt),
          date: formatDate(invoice.TxnDate),
          dueDate: formatDate(invoice.DueDate),
          balance: formatCurrency(invoice.Balance || 0),
          memo: invoice.CustomerMemo?.value || invoice.PrivateNote || 'No memo available'
        }
      };
    } catch (error) {
      log(`Error summarizing invoice:`, error);
      return { 
        error: `Failed to summarize invoice: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
  
  // Analyze invoices
  analyzeInvoices: async (params: any) => {
    try {
      const analysisType = params.analysisType || 'trends';
      log(`Analyzing invoices (${analysisType})`);
      
      // Get all invoices
      const invoicesResult = await actions.listInvoices();
      
      // Check if we got an error
      if (!Array.isArray(invoicesResult)) {
        return invoicesResult; // Pass through the error
      }
      
      const invoices = invoicesResult;
      
      // Basic analysis implementation (placeholder)
      return {
        analysisType,
        result: `Analyzed ${invoices.length} invoices`,
        summary: `Found ${invoices.length} invoices with a total value of $${invoices.reduce((sum, inv) => sum + (inv.TotalAmt || 0), 0).toFixed(2)}`
      };
    } catch (error) {
      log(`Error analyzing invoices:`, error);
      return { 
        error: `Failed to analyze invoices: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
};

export async function POST(request: Request) {
  try {
    // Parse the request body
    const body = await request.json();
    const { tool, params } = body;
    
    log(`Received tool request: ${tool}`, params);
    
    // Check if the requested tool exists
    if (!actions[tool]) {
      log(`Tool not found: ${tool}`);
      return NextResponse.json(
        { error: `Tool not found: ${tool}` },
        { status: 404 }
      );
    }
    
    // Execute the tool
    log(`Executing tool: ${tool}`);
    const result = await actions[tool](params?.id || params);
    
    log(`Tool execution result for ${tool}:`, result ? 'success' : 'failure');
    
    // Return the result
    return NextResponse.json(result);
    
  } catch (error) {
    log('Error processing tool request:', error);
    return NextResponse.json(
      { error: `Error executing tool: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
} 