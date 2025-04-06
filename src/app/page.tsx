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
  const [showConnect, setShowConnect] = useState(false)
  const [isQBConnected, setIsQBConnected] = useState(false)
  const [initialLoad, setInitialLoad] = useState(true)

  // Check QuickBooks auth status once on component mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const isAuthenticated = await checkQuickBooksAuth()
        setIsQBConnected(isAuthenticated)
        setShowConnect(!isAuthenticated)
        setInitialLoad(false)
      } catch (error) {
        console.error('Error checking auth:', error)
        setShowConnect(true)
        setInitialLoad(false)
      }
    }
    
    checkAuth()
    
    // Check URL for auth=success and clear it
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search)
      const authStatus = urlParams.get('auth')
      if (authStatus === 'success') {
        setIsQBConnected(true)
        setShowConnect(false)
        // Clean up URL after processing
        window.history.replaceState({}, document.title, window.location.pathname)
      }
    }
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

  // Handle successful QuickBooks connection
  const handleQuickBooksConnected = () => {
    setIsQBConnected(true)
    setShowConnect(false)
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
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <h1 className="text-xl font-medium text-gray-800">Invoice Management Dashboard</h1>
          {!isQBConnected && !initialLoad && (
            <button 
              onClick={() => setShowConnect(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded shadow hover:bg-blue-700"
            >
              Connect QuickBooks
            </button>
          )}
        </div>
      </header>
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {showConnect ? (
          <div className="my-8">
            <QuickbooksConnect 
              initialError={null} 
              onConnected={handleQuickBooksConnected}
            />
          </div>
        ) : (
          <div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2">
                <InvoicePanel />
              </div>
              <div className="lg:col-span-1">
                <ToolsPanel />
              </div>
            </div>
            <div className="mt-8">
              <AIChat />
            </div>
          </div>
        )}
      </main>
      
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