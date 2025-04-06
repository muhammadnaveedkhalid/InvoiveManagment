import { useChat, type Message } from 'ai/react';
import { useState, useEffect } from 'react';
import React from 'react';

interface ToolState {
  isExecuting: boolean;
  currentTool: string | null;
  lastResult: any;
}

interface ToolInvocation {
  id: string;
  name: string;
  arguments: Record<string, any>;
  result?: any;
}

// Extend the Message type to include toolInvocations
interface ExtendedMessage extends Message {
  toolInvocations?: ToolInvocation[];
}

interface AIChatProps {
  onSelectInvoice?: (id: string) => void;
  onToggleInvoicePanel?: (open: boolean) => void;
  isInvoicePanelOpen?: boolean;
}

export default function AIChat({ onSelectInvoice, onToggleInvoicePanel, isInvoicePanelOpen }: AIChatProps) {
  const [toolState, setToolState] = useState<ToolState>({
    isExecuting: false,
    currentTool: null,
    lastResult: null,
  });
  const [showError, setShowError] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [useGroq, setUseGroq] = useState(true); // Default to using Groq
  const [apiEndpoint, setApiEndpoint] = useState('/api/chat/groq'); // Default to Groq endpoint
  const [attemptedProviders, setAttemptedProviders] = useState<Set<string>>(new Set());
  const [autoLoadInvoice, setAutoLoadInvoice] = useState(false);

  // Update the endpoint when switching between Groq and OpenAI
  useEffect(() => {
    setApiEndpoint(useGroq ? '/api/chat/groq' : '/api/chat');
  }, [useGroq]);

  const resetChat = () => {
    window.location.reload(); // Force a full reset of the chat
  };

  const { messages, input, handleInputChange, handleSubmit, isLoading, error, reload } = useChat({
    api: apiEndpoint,
    onResponse: (response) => {
      // Check if the response is OK
      if (!response.ok) {
        // Track which provider we attempted
        setAttemptedProviders(prev => {
          const newSet = new Set(prev);
          newSet.add(apiEndpoint);
          return newSet;
        });

        // Parse the detailed error from the response if possible
        response.json().then(
          (errorData) => {
            console.error('API error details:', errorData);
            
            // If the error suggests using Groq instead
            if (errorData.useGroq && !useGroq) {
              console.log('API recommends switching to Groq, switching...');
              setUseGroq(true);
              setApiError('Switching to Groq API. Please retry your message.');
              return;
            }
            
            setApiError(`Error ${response.status}: ${errorData.error || 'Connection to AI failed'}`);
          },
          // If can't parse JSON, use the status text
          () => setApiError(`Error ${response.status}: ${response.statusText || 'Connection to AI failed'}`)
        );
        return;
      }
      
      // Reset error state and tool state when a new successful response starts
      setApiError(null);
      setToolState({
        isExecuting: false,
        currentTool: null,
        lastResult: null,
      });
      
      // Clear the attempted providers list on successful response
      setAttemptedProviders(new Set());
    },
    onFinish: (message) => {
      // Handle when the message is complete
      setApiError(null);
    },
    onError: (error) => {
      console.error('Chat error:', error);
      
      // Track which provider we attempted
      setAttemptedProviders(prev => {
        const newSet = new Set(prev);
        newSet.add(apiEndpoint);
        return newSet;
      });
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setApiError(`Failed to communicate with AI: ${errorMessage}. Try switching providers or refreshing.`);
    }
  });

  // Function to toggle between Groq and OpenAI
  const toggleProvider = () => {
    setUseGroq(prev => !prev);
    // Clear any existing errors when switching providers
    setApiError(null);
  };

  // Automatically try another provider if one fails and we haven't tried it yet
  useEffect(() => {
    if (apiError && !isRetrying) {
      // Only try OpenAI as fallback if Groq fails
      if (useGroq && !attemptedProviders.has('/api/chat')) {
        console.log('Groq failed, trying OpenAI as fallback');
        setUseGroq(false);
      }
    }
  }, [apiError, isRetrying, useGroq, attemptedProviders]);

  // Auto-select invoice when mentioned in chat
  useEffect(() => {
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === 'user') {
        // Look for invoice number mentions in various formats with more thorough patterns
        const invoicePatterns = [
          // Common invoice number patterns
          /invoice\s+#?(\d+)/gi,
          /inv[.\-_]?(\d+)/gi,
          /invoice\s+number\s+#?(\d+)/gi,
          // More specific with word boundaries
          /\b(invoice|inv)[.\-_ #]*(\d+)\b/gi,
          // Invoice with ID prefix
          /invoice\s+id[\s:#]*(\d+)/gi,
          // Asking about an invoice
          /(?:show|get|find|details\s+(?:for|about)|tell\s+me\s+about)\s+(?:invoice|inv)[.\-_ #]*(\d+)/gi,
        ];

        // Check each pattern and collect matches
        let invoiceId = null;
        for (const pattern of invoicePatterns) {
          const matches = Array.from(lastMessage.content.matchAll(pattern) || []);
          if (matches.length > 0) {
            // Get the numeric portion, checking the right capture group
            const match = matches[0];
            // If the pattern has multiple capture groups, use the last non-empty one
            for (let i = 1; i < match.length; i++) {
              if (match[i] && /^\d+$/.test(match[i])) {
                invoiceId = match[i];
                break;
              }
            }
            if (invoiceId) break;
          }
        }
        
        // If we found an invoice ID and have an onSelectInvoice handler, call it
        if (invoiceId && onSelectInvoice) {
          console.log(`Detected invoice reference: ${invoiceId}`);
          
          // Fetch invoice details for display in chat
          fetchInvoiceDetails(invoiceId);
          
          // Also select the invoice in the panel
          onSelectInvoice(invoiceId);
          
          // Also set autoLoadInvoice flag to true to indicate we've handled this message
          setAutoLoadInvoice(true);
        }
      }
    }
  }, [messages, onSelectInvoice]);

  // Function to fetch and display invoice details directly in chat
  const fetchInvoiceDetails = async (invoiceId: string) => {
    try {
      // Relax the condition to allow displaying invoice info in more situations
      if (!messages.length) {
        return;
      }
      
      // Get the last user message
      const lastUserMessage = messages.filter(m => m.role === 'user').pop();
      
      // Check if the user was explicitly asking for invoice details
      const isExplicitInvoiceRequest = lastUserMessage && (
        lastUserMessage.content.toLowerCase().includes(`invoice ${invoiceId}`) ||
        lastUserMessage.content.toLowerCase().includes(`invoice #${invoiceId}`) ||
        lastUserMessage.content.toLowerCase().includes(`invoice number ${invoiceId}`) ||
        lastUserMessage.content.toLowerCase().includes(`show me invoice ${invoiceId}`) ||
        lastUserMessage.content.toLowerCase().includes(`invoice details for ${invoiceId}`)
      );
      
      // Only display our panel for explicit requests
      if (!isExplicitInvoiceRequest) {
        console.log(`Not showing panel for invoice #${invoiceId} - not an explicit request`);
        return;
      }
      
      // Check for existing invoice data in AI responses
      const existingInvoiceInfoInChat = messages.some(m => 
        m.role === 'assistant' && 
        m.content.includes(`Invoice #${invoiceId}`) && 
        (m.content.includes('Customer:') || m.content.includes('Customer'))
      );
      
      // If we already have invoice info from the AI, don't add our own panel
      if (existingInvoiceInfoInChat) {
        console.log(`Invoice #${invoiceId} information already exists in chat, not adding panel`);
        return;
      }
      
      console.log(`Fetching details for invoice ${invoiceId} to display in chat`);
      
      // IMPORTANT: Use the chat API instead of the invoice API to get consistent data
      const response = await fetch(`/api/chat/tool`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tool: 'summarizeInvoice',
          params: { id: invoiceId }
        }),
      });
      
      if (!response.ok) {
        console.error(`Error fetching invoice ${invoiceId}:`, response.statusText);
        return;
      }
      
      const result = await response.json();
      console.log("Invoice data from chat API:", result); // Log the invoice data to debug
      
      // Check for errors or authentication issues
      if (result.error) {
        console.error(`Error with invoice ${invoiceId}:`, result.error);
        
        // Check if this is an authentication error
        if (
          result.error.includes('authentication') || 
          result.error.includes('connect your account') ||
          result.error.includes('Authentication required')
        ) {
          // Display authentication message in chat instead of invoice details
          const authMessageHtml = `
            <div class="bg-yellow-50 p-4 rounded-lg border border-yellow-200 my-3 shadow-sm">
              <div class="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-yellow-600 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <h3 class="text-lg font-medium text-yellow-800">QuickBooks Connection Required</h3>
              </div>
              <p class="mt-2 text-yellow-700">
                Please connect your QuickBooks account to view invoice details.
              </p>
              <div class="mt-3">
                <a href="/settings" class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-yellow-600 hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500">
                  Connect QuickBooks
                </a>
              </div>
            </div>
          `;
          
          const authDiv = document.createElement('div');
          authDiv.className = 'mb-4';
          authDiv.innerHTML = authMessageHtml;
          
          const chatContainer = document.getElementById('chat-messages-container');
          if (chatContainer) {
            chatContainer.appendChild(authDiv);
            setTimeout(() => {
              authDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 300);
          }
          
          return;
        }
        
        return;
      }
      
      // Use the result directly if it has the invoice data
      const invoice = result.invoice || result.data || result;
      
      // If we have invoice data, create a standardized display
      if (invoice && (invoice.Id || invoice.DocNumber || invoice.id || invoice.invoiceNumber)) {
        // Map invoice properties - QuickBooks can return different formats
        const standardInvoice = {
          id: invoice.Id || invoice.id || '',
          number: invoice.DocNumber || invoice.invoiceNumber || invoiceId,
          customerName: invoice.CustomerRef?.name || 
                      invoice.customerName || 
                      (typeof invoice.CustomerRef === 'string' ? invoice.CustomerRef : 'Unknown Customer'),
          amount: invoice.TotalAmt || invoice.amount || 0,
          balance: invoice.Balance !== undefined ? invoice.Balance : (invoice.balance !== undefined ? invoice.balance : 0),
          date: invoice.TxnDate || invoice.date || '',
          dueDate: invoice.DueDate || invoice.dueDate || '',
          memo: invoice.PrivateNote || invoice.CustomerMemo?.value || invoice.memo || ''
        };
        
        // Format currency - ensure consistency with InvoicePanel and ToolsPanel formatting
        const formatCurrency = (amount: number | string) => {
          if (amount === undefined || amount === null) return '$0.00';
          const numericAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
          return numericAmount ? `$${numericAmount.toFixed(2)}` : '$0.00';
        };

        // Format date in a more readable format (MM/DD/YYYY) - consistent with other components
        const formatDate = (dateStr: string) => {
          if (!dateStr) return 'Unknown';
          try {
            const date = new Date(dateStr);
            return date.toLocaleDateString('en-US', { 
              year: 'numeric', 
              month: 'numeric', 
              day: 'numeric' 
            });
          } catch (e) {
            return dateStr; // If invalid date, return the original string
          }
        };
        
        // Get billing address if available
        const billingAddress = invoice.BillAddr || invoice.billAddr || {};
        const addressLine1 = billingAddress.Line1 || billingAddress.line1 || '';
        const addressLine2 = billingAddress.Line2 || billingAddress.line2 || '';
        const city = billingAddress.City || billingAddress.city || '';
        const state = billingAddress.CountrySubDivisionCode || billingAddress.state || '';
        const zip = billingAddress.PostalCode || billingAddress.zip || '';
        
        // Construct formatted address
        const formattedAddress = [addressLine1, addressLine2, `${city}${city && state ? ', ' : ''}${state} ${zip}`]
          .filter(line => line.trim())
          .join('<br>');
        
        // Determine if invoice is paid or not
        const isPaid = standardInvoice.balance === 0 || standardInvoice.balance === '0';
        
        // Create a nicely formatted invoice details panel with more details
        const invoiceDetailsHtml = `
          <div class="bg-blue-50 p-4 rounded-lg border border-blue-200 my-3 shadow-sm">
            <div class="flex items-center justify-between">
              <h3 class="text-lg font-medium text-blue-800">Invoice #${standardInvoice.number}</h3>
              <span class="px-2 py-1 bg-${isPaid ? 'green' : 'orange'}-100 text-${isPaid ? 'green' : 'orange'}-800 text-sm rounded-full">
                ${isPaid ? 'Paid' : 'Unpaid'}
              </span>
            </div>
            
            <div class="grid md:grid-cols-2 gap-4 mt-3">
              <div>
                <h4 class="font-medium text-gray-700">Customer</h4>
                <p class="text-gray-800">${standardInvoice.customerName}</p>
                ${formattedAddress ? `<p class="text-sm text-gray-600 mt-1">${formattedAddress}</p>` : ''}
              </div>
              
              <div>
                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <h4 class="font-medium text-gray-700">Amount</h4>
                    <p class="text-gray-800">${formatCurrency(standardInvoice.amount)}</p>
                  </div>
                  
                  ${!isPaid ? `
                  <div>
                    <h4 class="font-medium text-gray-700">Balance Due</h4>
                    <p class="text-gray-800 font-medium text-orange-600">${formatCurrency(standardInvoice.balance)}</p>
                  </div>
                  ` : ''}
                  
                  <div>
                    <h4 class="font-medium text-gray-700">Date</h4>
                    <p class="text-gray-800">${formatDate(standardInvoice.date)}</p>
                  </div>
                  
                  <div>
                    <h4 class="font-medium text-gray-700">Due Date</h4>
                    <p class="text-gray-800">${formatDate(standardInvoice.dueDate)}</p>
                  </div>
                </div>
              </div>
            </div>
            
            ${standardInvoice.memo ? `
            <div class="mt-3 pt-3 border-t border-blue-200">
              <h4 class="font-medium text-gray-700">Memo</h4>
              <p class="text-gray-800 text-sm mt-1 bg-white p-2 rounded">${standardInvoice.memo}</p>
            </div>
            ` : ''}
          </div>
        `;
        
        // Add the HTML to a display div
        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'mb-4';
        detailsDiv.innerHTML = invoiceDetailsHtml;
        
        // Insert the details div at the appropriate position in the chat - after the user's message
        const chatContainer = document.getElementById('chat-messages-container');
        if (chatContainer) {
          // Clear any previous invoice displays to avoid duplicates
          const existingDisplays = document.querySelectorAll('.invoice-details-display');
          existingDisplays.forEach(el => el.remove());
          
          // Mark this div for potential future removal
          detailsDiv.classList.add('invoice-details-display');
          
          // Add to the chat container
          chatContainer.appendChild(detailsDiv);
          
          // Scroll to make the details visible
          setTimeout(() => {
            detailsDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }, 300);
        }
      } else {
        console.error('Invoice data is incomplete or invalid:', invoice);
      }
    } catch (error) {
      console.error('Error fetching invoice details:', error);
    }
  };

  // Auto-load the invoice panel if an invoice is mentioned
  useEffect(() => {
    if (autoLoadInvoice && !isInvoicePanelOpen && onToggleInvoicePanel) {
      console.log('Auto-opening invoice panel due to invoice mention');
      onToggleInvoicePanel(true);
      setAutoLoadInvoice(false);
    }
  }, [autoLoadInvoice, isInvoicePanelOpen, onToggleInvoicePanel]);

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim()) {
      setShowError(true);
      return;
    }
    
    // Reset error states
    setShowError(false);
    setApiError(null);
    
    // Look for invoice references before submission
    const invoicePatterns = [
      /\b(invoice|inv)[.\-_ #]*(\d+)\b/gi,
      /invoice\s+id[\s:#]*(\d+)/gi,
    ];
    
    let hasInvoiceReference = false;
    for (const pattern of invoicePatterns) {
      if (pattern.test(input)) {
        hasInvoiceReference = true;
        break;
      }
    }
    
    // If there's an invoice reference, add a hint to the AI about using tools
    if (hasInvoiceReference && onSelectInvoice) {
      console.log("Detected invoice reference in query, adding tool hint");
      // This is just a client-side log, won't modify the actual prompt
    }
    
    // Submit the form
    handleSubmit(e);
  };
  
  const handleRetry = () => {
    setIsRetrying(true);
    setApiError(null);
    
    // Attempt to reload the conversation
    reload();
    
    // Reset retry state after a delay
    setTimeout(() => {
      setIsRetrying(false);
    }, 1000);
  };

  // Function to render tool invocations if present
  const renderToolInvocations = (message: ExtendedMessage) => {
    if (!message.toolInvocations || message.toolInvocations.length === 0) {
      return null;
    }

    return (
      <div className="mt-2 border-t pt-2 text-xs text-gray-500">
        <div className="font-medium mb-1">Tool Calls:</div>
        {message.toolInvocations.map((tool: ToolInvocation, idx: number) => (
          <div key={idx} className="mb-2">
            <div className="font-medium text-blue-600">
              {tool.name} 
              <span className="text-gray-500 font-normal"> with args:</span>
            </div>
            <pre className="bg-gray-100 p-1 rounded text-xs overflow-auto">
              {JSON.stringify(tool.arguments, null, 2)}
            </pre>
            
            {tool.result && (
              <>
                <div className="font-medium text-green-600 mt-1">
                  <span className="text-gray-500 font-normal">Result:</span>
                </div>
                <pre className="bg-gray-100 p-1 rounded text-xs overflow-auto">
                  {typeof tool.result === 'string' 
                    ? tool.result 
                    : JSON.stringify(tool.result, null, 2)}
                </pre>
              </>
            )}
          </div>
        ))}
      </div>
    );
  };

  // Add a function to format invoice messages in chat that handles both formats
  const formatInvoiceMessage = (content: string) => {
    // Skip if already formatted with HTML
    if (content.includes('<div class="bg-blue-50') || content.includes('<h3 class="text-lg font-medium text-blue-800">')) {
      return content;
    }
    
    // Check if this is an invoice details message - more comprehensive check
    const isInvoiceDetails = content.includes('Invoice #') && (
      // Check for either format of customer info
      (content.includes('Customer:') || content.includes('\nCustomer\n')) &&
      // Check for either format of amount
      (content.includes('Amount:') || content.includes('\nAmount\n'))
    );
    
    if (!isInvoiceDetails) {
      return content; // Return unchanged if not an invoice details message
    }
    
    // Split into lines and format each line
    const lines = content.split('\n');
    
    // Extract invoice details - handle both formats
    let invoiceNumber = '';
    let customer = '';
    let amount = '';
    let date = '';
    let dueDate = '';
    let status = '';
    let balance = '';
    
    // First pass - look for standard format (Field: value)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Extract invoice number from the first line that mentions "Invoice #"
      if (line.includes('Invoice #')) {
        invoiceNumber = line.replace('Invoice #', '').trim();
      }
      
      // Match lines with field labels followed by colon
      if (line.startsWith('Customer:')) {
        customer = line.replace('Customer:', '').trim();
      } else if (line.startsWith('Amount:')) {
        amount = line.replace('Amount:', '').trim();
      } else if (line.startsWith('Date:')) {
        date = line.replace('Date:', '').trim();
      } else if (line.startsWith('Due Date:')) {
        dueDate = line.replace('Due Date:', '').trim();
      } else if (line.startsWith('Status:')) {
        status = line.replace('Status:', '').trim();
      } else if (line.startsWith('Balance Due:')) {
        balance = line.replace('Balance Due:', '').trim();
      }
    }
    
    // Second pass - look for alternate format (Field\nvalue)
    if (!customer || !amount) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Look for field names on their own line and grab the next line
        if (line === 'Customer' && i + 1 < lines.length) {
          customer = lines[i + 1].trim();
        } else if (line === 'Amount' && i + 1 < lines.length) {
          amount = lines[i + 1].trim();
        } else if (line === 'Date' && i + 1 < lines.length) {
          date = lines[i + 1].trim();
        } else if (line === 'Due Date' && i + 1 < lines.length) {
          dueDate = lines[i + 1].trim();
        } else if (line === 'Balance Due' && i + 1 < lines.length) {
          balance = lines[i + 1].trim();
        }
      }
    }
    
    // If not explicitly set, determine if paid based on content
    if (!status) {
      if (content.includes('Paid') && !content.includes('Unpaid')) {
        status = 'Paid';
      } else if (content.includes('Unpaid')) {
        status = 'Unpaid';
      }
    }
    
    // If we have enough info, format nicely
    if (invoiceNumber && (customer || amount)) {
      // Determine paid status - fallback to balance check if status not explicit
      const isPaid = status === 'Paid' || 
                     (balance && balance.includes('$0.00')) || 
                     (balance === '' && content.includes('Paid') && !content.includes('Unpaid'));
      
      // Format the invoice details nicely
      const formattedContent = `
        <div class="bg-blue-50 p-4 rounded-lg border border-blue-200 my-3 shadow-sm">
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-medium text-blue-800">Invoice #${invoiceNumber}</h3>
            <span class="px-2 py-1 bg-${isPaid ? 'green' : 'orange'}-100 text-${isPaid ? 'green' : 'orange'}-800 text-sm rounded-full">
              ${status || (isPaid ? 'Paid' : 'Unpaid')}
            </span>
          </div>
          
          <div class="grid md:grid-cols-2 gap-4 mt-3">
            <div>
              <h4 class="font-medium text-gray-700">Customer</h4>
              <p class="text-gray-800">${customer || 'Unknown'}</p>
            </div>
            
            <div>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <h4 class="font-medium text-gray-700">Amount</h4>
                  <p class="text-gray-800">${amount || 'Not specified'}</p>
                </div>
                
                ${(!isPaid && balance) ? `
                <div>
                  <h4 class="font-medium text-gray-700">Balance Due</h4>
                  <p class="text-gray-800 font-medium text-orange-600">${balance}</p>
                </div>
                ` : ''}
                
                <div>
                  <h4 class="font-medium text-gray-700">Date</h4>
                  <p class="text-gray-800">${date || 'Not specified'}</p>
                </div>
                
                <div>
                  <h4 class="font-medium text-gray-700">Due Date</h4>
                  <p class="text-gray-800">${dueDate || 'Not specified'}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
      
      return formattedContent;
    }
    
    return content; // If we can't extract enough data, return the original content
  };

  // Function to render message content with invoice formatting
  const renderMessageContent = (message: Message) => {
    if (message.role === 'assistant') {
      const formattedContent = formatInvoiceMessage(message.content);
      
      // If we detected an invoice in the message, check if we should prevent auto-loading
      const hasInvoiceFormatted = formattedContent !== message.content && 
                                formattedContent.includes('Invoice #') && 
                                onSelectInvoice;

      // Just return the formatted content - don't call hooks conditionally      
      return <div 
        dangerouslySetInnerHTML={{ __html: formattedContent }}
        className={hasInvoiceFormatted ? "formatted-invoice" : ""}
        data-has-invoice={hasInvoiceFormatted ? "true" : "false"}
      ></div>;
    }
    
    return message.content;
  };

  // Check for formatted invoices in assistant messages and prevent auto-loading
  useEffect(() => {
    // Get last assistant message
    const lastAssistantMessage = messages
      .filter(m => m.role === 'assistant')
      .pop();
      
    if (lastAssistantMessage) {
      // Check if this message contains a formatted invoice
      const content = lastAssistantMessage.content;
      const isFormatted = content.includes('<div class="bg-blue-50') || 
                         content.includes('<h3 class="text-lg font-medium text-blue-800">');
      const hasInvoice = content.includes('Invoice #') && 
                       (content.includes('Customer:') || content.includes('Customer\n')) &&
                       (content.includes('Amount:') || content.includes('Amount\n'));
                       
      if (isFormatted && hasInvoice && onSelectInvoice) {
        // If we already have a formatted invoice, don't auto-fetch
        setAutoLoadInvoice(false);
      }
    }
  }, [messages, onSelectInvoice]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto p-6 space-y-6" id="chat-messages-container">
        {/* API Provider Badge */}
        <div className="flex justify-between mb-2">
          <div className="text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded-full">
            Using {useGroq ? 'Groq AI' : 'OpenAI'} 
            <button 
              className="ml-2 text-blue-600 hover:text-blue-800 focus:outline-none"
              onClick={toggleProvider}
              title="Switch AI provider"
            >
              ⟳
            </button>
          </div>
          <button 
            onClick={resetChat}
            className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200"
            title="Reset chat"
          >
            Reset Chat
          </button>
        </div>
        
        {/* Error Alert with more details */}
        {apiError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">AI Error</h3>
                <div className="mt-1 text-sm text-red-700">{apiError}</div>
                <div className="mt-3 flex space-x-2">
                  <button
                    onClick={handleRetry}
                    disabled={isRetrying}
                    className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50"
                  >
                    {isRetrying ? 'Retrying...' : 'Retry Request'}
                  </button>
                  <button
                    onClick={toggleProvider}
                    className="inline-flex items-center px-3 py-1.5 border border-red-300 text-xs font-medium rounded-md text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                  >
                    Try {useGroq ? 'OpenAI' : 'Groq'} Instead
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex ${
              message.role === 'user' ? 'justify-end' : 'justify-start'
            }`}
          >
            <div
              className={`rounded-lg px-6 py-4 max-w-[80%] ${
                message.role === 'user'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100'
              }`}
            >
              {renderMessageContent(message)}
              {message.role === 'assistant' && toolState.isExecuting && (
                <div className="mt-2 text-sm text-gray-500">
                  Executing {toolState.currentTool}...
                </div>
              )}
              {message.role === 'assistant' && renderToolInvocations(message as ExtendedMessage)}
            </div>
          </div>
        ))}
        
        {isLoading && (
          <div className="flex justify-start">
            <div className="rounded-lg px-6 py-4 bg-gray-100">
              <div className="flex space-x-2">
                <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"></div>
                <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce delay-150"></div>
                <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce delay-300"></div>
              </div>
            </div>
          </div>
        )}
        
        {/* Help message if no messages yet */}
        {messages.length === 0 && !isLoading && !apiError && (
          <div className="flex justify-center items-center h-full">
            <div className="text-center p-6 bg-blue-50 rounded-lg max-w-lg">
              <h3 className="text-xl font-medium text-blue-800 mb-2">Welcome to Invoice Chat</h3>
              <p className="text-blue-600 mb-4">
                You can ask questions about your invoices, such as:
              </p>
              <ul className="text-left text-blue-700 space-y-2 mb-4">
                <li>• "Show me my recent invoices"</li>
                <li>• "What's the total amount billed last month?"</li>
                <li>• "Give me details about invoice #1001"</li>
                <li>• "Which customer has the highest outstanding balance?"</li>
              </ul>
              <p className="text-sm text-blue-500">
                Your invoices are synced from QuickBooks and will be loaded when you ask about them.
              </p>
              <div className="mt-4 text-sm text-gray-500">
                Using: {useGroq ? 'Groq AI' : 'OpenAI'} | <button onClick={toggleProvider} className="text-blue-500 hover:underline">Switch Provider</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleFormSubmit} className="p-6 border-t">
        <div className="flex flex-col space-y-4">
          <div className="flex space-x-4">
            <input
              id="chat-input"
              value={input}
              onChange={handleInputChange}
              placeholder="Ask about your invoices..."
              className={`flex-1 px-6 py-4 border rounded-lg focus:outline-none focus:ring-2 text-lg ${
                showError && !input.trim() ? 'border-red-500 focus:ring-red-500' : 'focus:ring-blue-500'
              }`}
              disabled={isLoading || toolState.isExecuting}
            />
            <button
              type="submit"
              disabled={isLoading || toolState.isExecuting || !input.trim()}
              className="px-6 py-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 text-lg"
            >
              Send
            </button>
          </div>
          {showError && !input.trim() && (
            <p className="text-sm text-red-500">Please enter a message</p>
          )}
        </div>
      </form>
    </div>
  );
} 