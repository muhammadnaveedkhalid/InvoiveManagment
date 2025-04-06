'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery } from 'react-query'
import { Invoice } from '@/types'
import QuickbooksConnect from '../QuickbooksConnect'
import { isQuickBooksReady } from '@/lib/quickbooks/api'

interface InvoicePanelProps {
  selectedInvoiceId?: string | null;
  onSelectInvoice?: (id: string) => void;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
const DEBUG = true;

// Helper function to log debug information
const debugLog = (...args: any[]) => {
  if (DEBUG) {
    console.log('[InvoicePanel Debug]', ...args);
  }
};

// Function to check if QuickBooks is authenticated
const checkQuickBooksAuth = async (): Promise<boolean> => {
  try {
    // First check if we have tokens in localStorage
    const readyInBrowser = isQuickBooksReady();
    debugLog('QuickBooks ready in browser:', readyInBrowser);
    
    if (readyInBrowser) {
      return true;
    }
    
    // If not, check with the server
    debugLog('Checking QuickBooks auth status with server');
    const response = await fetch(`${API_BASE_URL}/api/auth/status`)
    
    if (!response.ok) {
      const errorData = await response.json();
      debugLog('Server auth status check failed:', errorData);
      return false;
    }
    
    const data = await response.json()
    debugLog('Server auth status response:', data);
    return data.authenticated;
  } catch (error) {
    console.error('Error checking QuickBooks auth status:', error);
    return false;
  }
}

const fetchInvoices = async (): Promise<Invoice[]> => {
  debugLog('Fetching invoices using chat/tool API for consistency');
  
  try {
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
      throw new Error(`Failed to fetch invoices: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Handle either direct array response or response with invoices property
    if (Array.isArray(data)) {
      return data;
    } else if (data.invoices && Array.isArray(data.invoices)) {
      return data.invoices;
    } else if (data.error) {
      throw new Error(data.error);
    } else {
      throw new Error('Invalid response format from server');
    }
  } catch (error) {
    debugLog('Error fetching invoices:', error);
    throw error;
  }
};

export default function InvoicePanel({ 
  selectedInvoiceId = null, 
  onSelectInvoice 
}: InvoicePanelProps) {
  const [filter, setFilter] = useState('');
  const [showConnect, setShowConnect] = useState(true);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [hasAttemptedAuth, setHasAttemptedAuth] = useState(false);
  const [isRefetching, setIsRefetching] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [authSuccess, setAuthSuccess] = useState(false);
  const [autoLoadAttempted, setAutoLoadAttempted] = useState(false);
  const initialLoadTimer = useRef<NodeJS.Timeout | null>(null);
  const autoRetryTimer = useRef<NodeJS.Timeout | null>(null);

  const { data: invoices, isLoading, error, refetch } = useQuery('invoices', fetchInvoices, {
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
    refetchOnWindowFocus: false,
    // Always enable the query - it will check auth internally
    enabled: true,
    staleTime: 30000,
    cacheTime: 5 * 60 * 1000,
    onError: (err) => {
      debugLog('Query error:', err);
      if (err instanceof Error) {
        debugLog('Error message:', err.message);
        if (err.message.includes('QuickBooks client not initialized') || 
            err.message.includes('authentication failed')) {
          setShowConnect(true);
        } else if (err.message.includes('timed out')) {
          setRetryCount(prev => prev + 1);
          if (retryCount < 3) {
            setTimeout(() => {
              debugLog('Retrying after timeout');
              refetch();
            }, 2000);
          }
        }
      }
      setAutoLoadAttempted(true);
      
      // Set up auto-retry after error
      if (autoRetryTimer.current) {
        clearTimeout(autoRetryTimer.current);
      }
      
      autoRetryTimer.current = setTimeout(() => {
        debugLog('Auto-retrying after error');
        refetch();
      }, 5000);
    },
    onSuccess: (data) => {
      debugLog('Query success, received invoices:', data?.length);
      setRetryCount(0);
      setAutoLoadAttempted(true);
      
      // Clear any retry timers on success
      if (autoRetryTimer.current) {
        clearTimeout(autoRetryTimer.current);
        autoRetryTimer.current = null;
      }
    }
  });

  // Force refetch when component mounts to ensure data is fresh
  useEffect(() => {
    debugLog('Component mounted, triggering initial fetch');
    // Use a shorter delay for the initial fetch
    setTimeout(() => {
      refetch();
    }, 500);
    
    return () => {
      // Cleanup timers on unmount
      if (initialLoadTimer.current) {
        clearTimeout(initialLoadTimer.current);
      }
      if (autoRetryTimer.current) {
        clearTimeout(autoRetryTimer.current);
      }
    };
  }, []);

  // Set up automatic load after authentication
  useEffect(() => {
    // Clear any existing timers first
    if (initialLoadTimer.current) {
      clearTimeout(initialLoadTimer.current);
    }
    
    debugLog('Auth state changed. authSuccess:', authSuccess, 'showConnect:', showConnect);
    
    if (authSuccess && !showConnect) {
      debugLog('Auth success detected, setting up automatic invoice loading');
      
      // Set a timer to load invoices automatically
      initialLoadTimer.current = setTimeout(() => {
        debugLog('Auto-loading invoices after auth success');
        setAutoLoadAttempted(true);
        refetch();
      }, 1000);
    }
    
    // Cleanup function
    return () => {
      if (initialLoadTimer.current) {
        clearTimeout(initialLoadTimer.current);
      }
    };
  }, [authSuccess, showConnect, refetch]);

  useEffect(() => {
    debugLog('InvoicePanel mounted or URL params changed');
    
    // Check for auth query params
    const urlParams = new URLSearchParams(window.location.search);
    const authStatus = urlParams.get('auth');
    const errorMessage = urlParams.get('message');
    const tokenObtained = urlParams.get('tokenObtained');
    
    debugLog('URL parameters:', { authStatus, errorMessage, tokenObtained });
    
    if (authStatus === 'success') {
      debugLog('Authentication successful, token obtained:', tokenObtained);
      setShowConnect(false); // Hide connect UI after successful auth
      setHasAttemptedAuth(true);
      setAuthSuccess(true);
      
      // Force an immediate refetch when auth is successful
      setTimeout(() => {
        debugLog('Immediately refetching invoices after auth success');
        refetch();
      }, 100);
      
      // Remove query params to avoid refreshing on page reload, but after a delay
      // to allow other components to detect the auth success
      setTimeout(() => {
        debugLog('Cleaning up URL params after delay');
        window.history.replaceState({}, document.title, window.location.pathname);
      }, 2000);
    } else if (authStatus === 'error' && errorMessage) {
      console.error('Authentication error:', errorMessage);
      setErrorDetails(errorMessage);
      setShowConnect(true);
      setHasAttemptedAuth(true);
      setAuthSuccess(false);
      
      // Keep the error message available but clean up the URL
      setTimeout(() => {
        debugLog('Cleaning up error URL params');
        window.history.replaceState({}, document.title, window.location.pathname);
      }, 2000);
    } else if (!hasAttemptedAuth) {
      // Check authentication status if no URL parameters and we haven't attempted auth yet
      debugLog('Checking authentication status');
      
      checkQuickBooksAuth().then(isAuthenticated => {
        debugLog('QuickBooks authentication status:', isAuthenticated);
        setShowConnect(!isAuthenticated);
        setAuthSuccess(isAuthenticated);
        
        if (isAuthenticated) {
          debugLog('Already authenticated, scheduling immediate invoice fetch');
          // Force an immediate refetch when already authenticated
          setTimeout(() => {
            refetch();
          }, 100);
        }
        
        setHasAttemptedAuth(true);
      });
    }
  }, [refetch, hasAttemptedAuth]);

  // Check QuickBooks status on mount
  useEffect(() => {
    const checkQuickBooksStatus = async () => {
      try {
        if (invoices && invoices.length > 0) {
                    // If we already have invoices, we can skip authentication check
          setShowConnect(false);
          return;
        }
        
        const isAuthenticated = await checkQuickBooksAuth();
        if (!isAuthenticated) {
          setShowConnect(true);
        } else {
          setShowConnect(false);
        }
      } catch (err) {
        console.error('Error checking QuickBooks status:', err);
      }
    };
    
    checkQuickBooksStatus();
  }, [invoices?.length]);

  const filteredInvoices = invoices?.filter(invoice => 
    invoice.DocNumber.toLowerCase().includes(filter.toLowerCase()) ||
    invoice.CustomerRef.name.toLowerCase().includes(filter.toLowerCase())
  );

  // If showing connect UI, render it
  if (showConnect) {
    debugLog('Rendering QuickbooksConnect component');
    return (
      <div className="h-full">
        <QuickbooksConnect initialError={errorDetails} />
      </div>
    );
  }

  if (isLoading) {
    debugLog('Rendering loading state');
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
          <p className="mt-4 text-blue-500">Loading QuickBooks invoices...</p>
          {retryCount > 0 && (
            <button
              onClick={() => {
                debugLog('Manual retry button clicked');
                refetch();
              }}
              className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Retry Loading
            </button>
          )}
        </div>
      </div>
    );
  }

  if (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    debugLog('Rendering error state:', errorMessage);
    
    return (
      <div className="h-full flex flex-col items-center justify-center p-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 max-w-md mb-4">
          <h3 className="text-lg font-bold text-red-600 mb-2">Error loading invoices</h3>
          <p className="text-red-600">{errorMessage}</p>
          <p className="mt-4 text-gray-600">Please check your QuickBooks connection or try again.</p>
          <div className="mt-4 flex flex-col gap-2">
            <button 
              onClick={() => {
                debugLog('Reconnect button clicked');
                setShowConnect(true);
              }}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 w-full"
            >
              Connect to QuickBooks
            </button>
            <button 
              onClick={() => {
                debugLog('Retry button clicked');
                refetch();
              }}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 w-full"
            >
              Retry Fetch
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!invoices || invoices.length === 0) {
    debugLog('Rendering empty state (no invoices). isLoading:', isLoading, 'autoLoadAttempted:', autoLoadAttempted);
    
    // Always show the loading indicator for the first few seconds
    const shouldShowLoading = isLoading || (!invoices && Date.now() - new Date().getTime() < 5000);
    
    return (
      <div className="h-full flex items-center justify-center">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 max-w-md">
          <h3 className="text-lg font-bold text-blue-600 mb-2">Invoice Tools</h3>
          <p className="text-gray-600">Select an invoice and tool to analyze your data</p>
          
          {shouldShowLoading ? (
            <div className="mt-4 flex flex-col items-center justify-center">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500 mb-2"></div>
              <p className="text-blue-600">Invoices are loading automatically...</p>
            </div>
          ) : (
            <>
              <p className="mt-2 text-gray-500">No invoices found in your QuickBooks account.</p>
              <div className="mt-4 flex flex-col gap-2">
                <button 
                  onClick={() => {
                    debugLog('Reconnect button clicked (empty state)');
                    setShowConnect(true);
                  }}
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 w-full"
                >
                  Connect to QuickBooks
                </button>
                <button 
                  onClick={() => {
                    debugLog('Manual fetch button clicked');
                    setAutoLoadAttempted(false);
                    refetch();
                  }}
                  className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 w-full"
                >
                  Refresh Invoices
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  debugLog('Rendering invoice list with', invoices.length, 'invoices');
  return (
    <div className="h-full flex flex-col bg-white rounded-lg shadow-md">
      <div className="p-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-800">QuickBooks Invoices</h1>
          <div className="flex space-x-2">
           
            <button
              onClick={() => {
                debugLog('Reconnect button clicked (header)');
                setShowConnect(true);
              }}
              className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-md shadow-sm flex items-center"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Reconnect
            </button>
          </div>
        </div>
        <div className="mt-3">
          <div className="relative">
            <input
              type="text"
              placeholder="Search by invoice number or customer name..."
              className="w-full p-2 pl-10 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <div className="absolute left-3 top-2.5 text-gray-400">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {filteredInvoices && filteredInvoices.length > 0 ? (
          <div className="divide-y divide-gray-200">
            {filteredInvoices.map((invoice: Invoice) => (
              <div
                key={invoice.Id}
                className={`p-4 cursor-pointer hover:bg-blue-50 transition-colors duration-150 ${
                  selectedInvoiceId === invoice.Id ? 'bg-blue-100 border-l-4 border-blue-500' : ''
                }`}
                onClick={() => {
                  debugLog('Invoice selected:', invoice.Id);
                  if (onSelectInvoice) {
                    onSelectInvoice(invoice.Id);
                  }
                }}
              >
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="font-medium text-lg text-gray-800">Invoice #{invoice.DocNumber}</h3>
                    <p className="text-gray-600 mt-1">
                      {invoice.CustomerRef.name}
                    </p>
                    <div className="mt-1 flex items-center">
                      <div className={`w-2 h-2 rounded-full mr-2 ${(invoice.Balance || 0) > 0 ? 'bg-orange-500' : 'bg-green-500'}`}></div>
                      <p className="text-sm text-gray-500">
                        {(invoice.Balance || 0) > 0 ? 'Balance due' : 'Paid'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-lg font-bold ${(invoice.Balance || 0) > 0 ? 'text-orange-500' : 'text-green-600'}`}>
                      ${Number(invoice.TotalAmt).toFixed(2)}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">
                      Date: {new Date(invoice.TxnDate).toLocaleDateString()}
                    </p>
                    {invoice.DueDate && (
                      <p className="text-sm text-gray-500">
                        Due: {new Date(invoice.DueDate).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-500">No invoices match your search criteria</p>
          </div>
        )}
      </div>
    </div>
  );
} 