import { useState, useEffect } from 'react'
import { invoiceTools, handleToolCall } from '@/lib/ai/tools'
import { Invoice } from '@/types/invoice'
import QuickbooksConnect from '../QuickbooksConnect'
import { isQuickBooksReady, manuallyInitializeQuickBooks } from '@/lib/quickbooks/api'

interface ToolStatus {
  name: string
  status: 'idle' | 'executing' | 'completed' | 'error'
  result?: any
}

const API_BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'

// Function to check if QuickBooks is authenticated
const checkQuickBooksAuth = async (): Promise<boolean> => {
  try {
    // First check if we have tokens in localStorage
    if (isQuickBooksReady()) {
      return true;
    }
    
    // If not, check with the server
    const response = await fetch(`${API_BASE_URL}/api/auth/status`)
    if (!response.ok) {
      return false
    }
    const data = await response.json()
    return data.authenticated
  } catch (error) {
    console.error('Error checking QuickBooks auth status:', error)
    return false
  }
}

export default function ToolsPanel() {
  const [toolStatus, setToolStatus] = useState<Record<string, ToolStatus>>(
    Object.keys(invoiceTools).reduce((acc, toolName) => ({
      ...acc,
      [toolName]: { name: toolName, status: 'idle' }
    }), {})
  )
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('')
  const [selectedTool, setSelectedTool] = useState('summarizeInvoice')
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showConnect, setShowConnect] = useState(false)
  const [hasLoadedInvoices, setHasLoadedInvoices] = useState(false)
  const [autoFetchAttempted, setAutoFetchAttempted] = useState(false)

  // Function to fetch invoices for tools panel
  const fetchInvoices = async () => {
    try {
      setIsLoading(true)
      setError(null)
      
      console.log('Fetching invoices for tools panel using chat/tool API');
      
      // Use the new centralized endpoint for consistent data
      const response = await fetch('/api/chat/tool', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tool: 'listInvoices',
          params: {}
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Error response from invoices API:', errorData);
        throw new Error(errorData.error || 'Failed to fetch invoices')
      }
      
      const data = await response.json();
      console.log(`Successfully fetched invoices for tools panel`);
      
      // Handle different response formats
      let invoicesData;
      if (Array.isArray(data)) {
        invoicesData = data;
      } else if (data.invoices && Array.isArray(data.invoices)) {
        invoicesData = data.invoices;
      } else if (data.error) {
        throw new Error(data.error);
      } else {
        throw new Error('Invalid response format from server');
      }
      
      setInvoices(invoicesData)
      setHasLoadedInvoices(true)
      
      // Auto-select the first invoice if available
      if (invoicesData.length > 0) {
        setSelectedInvoiceId(invoicesData[0].Id)
        
        // Auto-execute the default tool if an invoice is selected
        setTimeout(() => {
          handleToolClick('summarizeInvoice');
        }, 500);
      }
    } catch (err) {
      console.error('Error fetching invoices:', err);
      
      // If it's an authentication error, show connect UI
      if (err instanceof Error && err.message.includes('QuickBooks client not initialized')) {
        setShowConnect(true)
      }
      
      setError(err instanceof Error ? err.message : 'Failed to load invoices')
      setHasLoadedInvoices(true)
    } finally {
      setIsLoading(false)
      setAutoFetchAttempted(true)
    }
  }

  useEffect(() => {
    const checkQuickBooksStatus = async () => {
      try {
        setIsLoading(true)
        
        // First check if QuickBooks is authenticated
        const isAuthenticated = await checkQuickBooksAuth()
        if (!isAuthenticated && !hasLoadedInvoices) {
          console.log('QuickBooks not authenticated, showing connect UI');
          setShowConnect(true);
          setIsLoading(false);
          return; // Don't try to fetch invoices if not authenticated
        }
        
        // If we've already loaded invoices successfully, don't show connect UI again
        if (hasLoadedInvoices) {
          setShowConnect(false);
        }
        
        // Check for auth query params in case we just completed authentication
        const urlParams = new URLSearchParams(window.location.search)
        const authStatus = urlParams.get('auth')
        
        if (authStatus === 'success') {
          console.log('Authentication success detected, clearing URL params');
          window.history.replaceState({}, document.title, window.location.pathname)
        }
        
        // Automatically fetch invoices instead of waiting for button click
        console.log('QuickBooks authenticated, automatically fetching invoices');
        fetchInvoices();
      } catch (err) {
        console.error('Error checking QuickBooks status:', err);
        setError(err instanceof Error ? err.message : 'Failed to check QuickBooks status')
        setIsLoading(false)
      }
    }

    checkQuickBooksStatus()
  }, [hasLoadedInvoices])
  
  // Set up a retry mechanism in case the first attempt fails
  useEffect(() => {
    // If we're not showing the connect UI and haven't loaded invoices yet, retry after a delay
    if (!showConnect && !hasLoadedInvoices && !isLoading && !autoFetchAttempted) {
      console.log('Setting up automatic retry for invoice fetching');
      const retryTimer = setTimeout(() => {
        console.log('Auto-retrying invoice fetch');
        fetchInvoices();
      }, 2000);
      
      return () => clearTimeout(retryTimer);
    }
  }, [showConnect, hasLoadedInvoices, isLoading, autoFetchAttempted]);

  const clearToolResults = () => {
    setToolStatus(prev => {
      const newStatus = { ...prev }
      Object.keys(newStatus).forEach(key => {
        newStatus[key] = { 
          ...newStatus[key], 
          status: 'idle',
          result: null 
        }
      })
      return newStatus
    })
  }

  const handleToolSelect = (toolName: string) => {
    setSelectedTool(toolName)
    clearToolResults()
  }

  const handleToolClick = async (toolName: string) => {
    const tool = invoiceTools[toolName as keyof typeof invoiceTools]
    if (!tool) return

    setToolStatus(prev => {
      const newStatus = { ...prev }
      Object.keys(newStatus).forEach(key => {
        if (key !== toolName) {
          newStatus[key] = { 
            ...newStatus[key], 
            status: 'idle',
            result: null 
          }
        }
      })
      return {
        ...newStatus,
        [toolName]: { ...newStatus[toolName], status: 'executing' }
      }
    })

    try {
      console.log(`Executing tool: ${toolName}`);
      let result: any
      if (toolName === 'getInvoice') {
        result = await handleToolCall(toolName, { id: selectedInvoiceId })
      } else if (toolName === 'listInvoices') {
        result = await handleToolCall(toolName, {})
      } else if (toolName === 'summarizeInvoice') {
        result = await handleToolCall(toolName, { id: selectedInvoiceId })
      } else if (toolName === 'analyzeInvoices') {
        result = await handleToolCall(toolName, { analysisType: 'trends' })
      }

      console.log(`Tool execution completed: ${toolName}`);
      setToolStatus(prev => ({
        ...prev,
        [toolName]: { 
          ...prev[toolName], 
          status: 'completed',
          result
        }
      }))
    } catch (error) {
      console.error(`Error executing tool ${toolName}:`, error);
      setToolStatus(prev => ({
        ...prev,
        [toolName]: { 
          ...prev[toolName], 
          status: 'error',
          result: error
        }
      }))
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'idle': return 'bg-gray-200'
      case 'executing': return 'bg-yellow-200'
      case 'completed': return 'bg-green-200'
      case 'error': return 'bg-red-200'
      default: return 'bg-gray-200'
    }
  }

  const renderResult = (result: any, toolName: string) => {
    if (!result) return null;

    if (toolName === 'summarizeInvoice') {
      // Add safety checks for result structure
      const summary = result.summary || 'Invoice Summary';
      const details = result.details || {};
      const balance = details.balance || '$0.00';
      const amount = details.amount || '$0.00';
      const date = details.date || 'Unknown';
      const dueDate = details.dueDate || 'Unknown';
      const memo = details.memo || 'No memo available';

      return (
        <div className="mt-4 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-semibold text-gray-800">{summary}</h4>
            <span className="px-2 py-1 bg-blue-100 text-blue-800 text-sm rounded-full">
              {balance}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="space-y-2">
              <div>
                <span className="text-gray-500">Amount:</span>
                <span className="ml-2 font-medium">{amount}</span>
              </div>
              <div>
                <span className="text-gray-500">Date:</span>
                <span className="ml-2 font-medium">{date}</span>
              </div>
              <div>
                <span className="text-gray-500">Due Date:</span>
                <span className="ml-2 font-medium">{dueDate}</span>
              </div>
            </div>
            <div className="space-y-2">
              <div>
                <span className="text-gray-500">Balance:</span>
                <span className="ml-2 font-medium">{balance}</span>
              </div>
              <div className="col-span-2">
                <span className="text-gray-500">Memo:</span>
                <p className="mt-1 p-2 bg-gray-50 rounded text-gray-700">
                  {memo}
                </p>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="mt-2 p-2 bg-gray-50 rounded">
        <pre className="text-sm overflow-auto">
          {JSON.stringify(result, null, 2)}
        </pre>
      </div>
    );
  };

  const handleDirectInitialization = async () => {
    try {
      console.log('Attempting direct QuickBooks initialization');
      const result = manuallyInitializeQuickBooks();
      
      if (result) {
        console.log('QuickBooks manual initialization successful');
        // Refresh the page to apply the changes
        window.location.reload();
      } else {
        setError('Failed to manually initialize QuickBooks');
      }
    } catch (err) {
      console.error('Error during manual initialization:', err);
      setError('Error during manual initialization: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  // Modify the UI to remove the "Fetch Invoices" button and show auto-loading indicator
  if (!hasLoadedInvoices || isLoading) {
    return (
      <div className="h-full p-4 flex flex-col">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-gray-800">Invoice Tools</h2>
          <p className="text-sm text-gray-600">Loading invoice tools...</p>
        </div>
        
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500 mb-3"></div>
            <p className="text-blue-600 text-sm">Automatically loading invoice data...</p>
          </div>
        </div>
      </div>
    );
  }

  if (showConnect) {
    return (
      <div className="h-full p-4">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-gray-800">Invoice Tools</h2>
          <p className="text-sm text-gray-600 mb-2">Connect your QuickBooks account to use these tools</p>
        </div>
        <QuickbooksConnect />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full p-4">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-gray-800">Invoice Tools</h2>
          <p className="text-sm text-gray-600 mb-2">There was an error loading invoice data</p>
        </div>
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg mb-4">
          <p className="text-red-600">{error}</p>
        </div>
        <button 
          onClick={() => fetchInvoices()}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (invoices.length === 0) {
    return (
      <div className="h-full p-4">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-gray-800">Invoice Tools</h2>
          <p className="text-sm text-gray-600 mb-2">No invoices found in your QuickBooks account</p>
        </div>
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-blue-600">Please add invoices to your QuickBooks account to use these tools.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 border-t">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Invoice Tools</h2>
        <p className="text-gray-600">Select an invoice and tool to analyze your data</p>
      </div>

      {/* Add a button to manually fetch invoices if none exist */}
      {invoices.length === 0 && (
        <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <p className="text-blue-700 mb-3">No invoices have been loaded yet. Click the button below to fetch invoices:</p>
          <button
            onClick={fetchInvoices}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Fetch Invoices
          </button>
        </div>
      )}

      {invoices.length > 0 && (
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className="flex items-center space-x-4">
            <div className="flex-1">
              <label htmlFor="invoice-select" className="block text-sm font-medium text-gray-700 mb-1">
                Select Invoice
              </label>
              <select
                id="invoice-select"
                value={selectedInvoiceId}
                onChange={(e) => setSelectedInvoiceId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              >
                {invoices.map((invoice) => (
                  <option key={invoice.Id} value={invoice.Id}>
                    Invoice #{invoice.DocNumber} - {invoice.CustomerRef.name} (${invoice.TotalAmt})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1">
              <label htmlFor="tool-select" className="block text-sm font-medium text-gray-700 mb-1">
                Select Tool
              </label>
              <select
                id="tool-select"
                value={selectedTool}
                onChange={(e) => handleToolSelect(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              >
                {Object.entries(invoiceTools).map(([name, tool]) => (
                  <option key={name} value={name}>
                    {tool.name} - {tool.description}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end">
              <button
                onClick={() => handleToolClick(selectedTool)}
                disabled={toolStatus[selectedTool].status === 'executing' || !selectedInvoiceId}
                className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 h-[42px]"
              >
                Execute
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {Object.entries(invoiceTools).map(([name, tool]) => (
          <div key={name} className="border rounded-lg p-4">
            <div className="flex justify-between items-center mb-2">
              <div>
                <h4 className="font-medium">{tool.name}</h4>
                <p className="text-sm text-gray-600">{tool.description}</p>
              </div>
              <button
                onClick={() => handleToolClick(name)}
                disabled={toolStatus[name].status === 'executing' || !selectedInvoiceId || invoices.length === 0}
                className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
              >
                Execute
              </button>
            </div>
            
            <div className="flex items-center space-x-2">
              <div className={`w-3 h-3 rounded-full ${getStatusColor(toolStatus[name].status)}`} />
              <span className="text-sm capitalize">{toolStatus[name].status}</span>
            </div>

            {toolStatus[name].result && renderResult(toolStatus[name].result, name)}
          </div>
        ))}
      </div>
    </div>
  )
} 