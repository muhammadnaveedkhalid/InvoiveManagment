'use client'

import { useState, useEffect } from 'react'
import InvoicePanel from './components/InvoicePanel'
import AIChat from './components/AIChat'
import ToolsPanel from './components/ToolsPanel'
import QuickbooksConnect from './components/QuickbooksConnect'
import { isQuickBooksReady } from '@/lib/quickbooks/api'

// Define your own checkAuth function in the page
const checkQuickBooksAuth = async (): Promise<boolean> => {
  try {
    // First check if we have tokens in localStorage
    if (isQuickBooksReady()) {
      return true;
    }
    
    // If not, check with the server
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
    const response = await fetch(`${baseUrl}/api/auth/status`)
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

export default function Home() {
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)
  const [showDebug, setShowDebug] = useState(false)
  const [isInvoicePanelOpen, setIsInvoicePanelOpen] = useState(true)

  // Check authentication on page load and URL changes
  useEffect(() => {
    const checkAuth = async () => {
      try {
        // First check localStorage
        if (isQuickBooksReady()) {
          setIsAuthenticated(true);
          return;
        }

        // Check with server
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
        const response = await fetch(`${baseUrl}/api/auth/status`)
        const data = await response.json()
        setIsAuthenticated(data.authenticated)

        // Check URL parameters for auth success
        const urlParams = new URLSearchParams(window.location.search);
        const authStatus = urlParams.get('auth');
        if (authStatus === 'success') {
          console.log('Auth success detected in URL');
          setIsAuthenticated(true);
          
          // Do not clean up URL immediately - leave it for components to detect
          // Components like InvoicePanel will handle URL cleanup after they've processed the auth success
        }
      } catch (error) {
        console.error("Error checking authentication:", error)
        setIsAuthenticated(false)
      }
    }
    checkAuth()
  }, [])

  // Press D key 5 times to show debug panel
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let keypresses = 0;
    let lastKeyTime = 0;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      // Safely check if e.key exists before calling toLowerCase()
      if (e && e.key && e.key.toLowerCase() === 'd') {
        const now = Date.now();
        if (now - lastKeyTime < 1000) {
          keypresses++;
        } else {
          keypresses = 1;
        }
        lastKeyTime = now;
        
        if (keypresses >= 5) {
          setShowDebug(true);
          keypresses = 0;
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Function to toggle invoice panel visibility
  const toggleInvoicePanel = (open: boolean) => {
    setIsInvoicePanelOpen(open);
  }

  // Show QuickBooks connect if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto py-12">
          <QuickbooksConnect />
          
          {/* Always visible debug panel for troubleshooting */}
          <div className="mt-8 border-t border-gray-200 pt-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-800">Connection Troubleshooting</h2>
              <div className="text-sm text-gray-500">Use these tools to debug connection issues</div>
            </div>
            
            <div className="grid gap-4">
              <DebugAction 
                title="Check Auth Status" 
                description="Check the current QuickBooks authentication status"
                endpoint="/api/auth/status"
              />
              <DebugAction 
                title="Fetch Invoices Directly" 
                description="Attempt to directly fetch invoices from QuickBooks"
                endpoint="/api/invoices"
              />
              <DebugAction 
                title="Debug Tokens" 
                description="Check the token status in cookies and memory"
                endpoint="/api/auth/debug"
              />
              <DebugAction 
                title="Manual Initialize" 
                description="Try to manually initialize QuickBooks client"
                endpoint="/api/auth/status"
                method="POST"
              />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Debug panel component
  const DebugPanel = () => {
    const [status, setStatus] = useState<any>(null);
    
    const checkStatus = async () => {
      try {
        const response = await fetch('/api/auth/debug');
        const data = await response.json();
        setStatus(data);
      } catch (error) {
        console.error('Error checking status:', error);
        setStatus({ error: String(error) });
      }
    };
    
    const initializeDirectly = async () => {
      try {
        const response = await fetch('/api/auth/debug', { method: 'POST' });
        const data = await response.json();
        setStatus(data);
        if (data.success) {
          window.location.reload();
        }
      } catch (error) {
        console.error('Error initializing:', error);
        setStatus({ error: String(error) });
      }
    };
    
    return (
      <div className="fixed top-0 right-0 z-50 bg-black bg-opacity-90 text-green-400 p-4 rounded-bl-lg max-w-md overflow-auto max-h-screen text-xs font-mono">
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-sm font-bold">QuickBooks Debug Panel</h3>
          <button 
            onClick={() => setShowDebug(false)}
            className="text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>
        
        <div className="space-y-2">
          <button 
            onClick={checkStatus}
            className="bg-gray-800 text-white px-3 py-1 rounded-sm hover:bg-gray-700 text-xs mr-2"
          >
            Check Status
          </button>
          
          <button 
            onClick={initializeDirectly}
            className="bg-blue-800 text-white px-3 py-1 rounded-sm hover:bg-blue-700 text-xs"
          >
            Initialize Directly
          </button>
        </div>
        
        {status && (
          <pre className="mt-3 text-xs overflow-auto max-h-96 p-2 bg-gray-900 rounded">
            {JSON.stringify(status, null, 2)}
          </pre>
        )}
      </div>
    );
  };

  // Main app layout when authenticated
  return (
    <div className="flex h-screen bg-white">
      {/* Left Panel - Invoices */}
      <div className={`${isInvoicePanelOpen ? 'w-1/3' : 'w-0'} border-r border-gray-200 overflow-hidden transition-width duration-300 ease-in-out`}>
        <InvoicePanel
          selectedInvoiceId={selectedInvoiceId}
          onSelectInvoice={setSelectedInvoiceId}
        />
      </div>

      {/* Right Panel - Chat and Tools */}
      <div className={`${isInvoicePanelOpen ? 'w-2/3' : 'w-full'} flex flex-col transition-width duration-300 ease-in-out`}>
        <div className="flex-1 overflow-hidden">
          <AIChat 
            onSelectInvoice={setSelectedInvoiceId} 
            onToggleInvoicePanel={toggleInvoicePanel}
            isInvoicePanelOpen={isInvoicePanelOpen}
          />
        </div>
        <div className="h-64 border-t border-gray-200 overflow-auto">
          <ToolsPanel />
        </div>
      </div>
      
      {/* Debug Panel */}
      {showDebug && <DebugPanel />}
    </div>
  )
}

// Debug action component for testing
function DebugAction({ title, description, endpoint, method = 'GET' }: { 
  title: string, 
  description: string,
  endpoint: string,
  method?: string 
}) {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const handleAction = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(endpoint, { method });
      const data = await response.json();
      setResult(data);
      if (!response.ok) {
        setError(`Error ${response.status}: ${data.error || 'Unknown error'}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div className="bg-gray-50 p-4 rounded-lg">
      <div className="flex justify-between items-center mb-2">
        <div>
          <h3 className="font-medium">{title}</h3>
          <p className="text-sm text-gray-600">{description}</p>
        </div>
        <button
          onClick={handleAction}
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Run'}
        </button>
      </div>
      
      {error && (
        <div className="mt-2 p-3 bg-red-50 rounded text-red-600 text-sm">
          <strong>Error:</strong> {error}
        </div>
      )}
      
      {result && !error && (
        <div className="mt-2">
          <details>
            <summary className="cursor-pointer text-sm text-blue-600">View Results</summary>
            <pre className="mt-2 p-3 bg-gray-100 rounded text-xs overflow-auto max-h-40">
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
} 