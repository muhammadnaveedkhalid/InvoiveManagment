'use client'

import { useState, useEffect } from 'react'
import { getRedirectUriForDisplay } from '@/lib/quickbooks/api'
import { initQuickBooksDirectly } from '@/lib/quickbooks/directAuth'
import styles from './QuickbooksConnect.module.css'

interface QuickbooksConnectProps {
  initialError?: string | null;
  onConnected?: () => void;
}

export default function QuickbooksConnect({ initialError = null, onConnected }: QuickbooksConnectProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(initialError)
  const [detailedError, setDetailedError] = useState<string | null>(null)
  const [redirectUri, setRedirectUri] = useState<string>('')
  const [isClient, setIsClient] = useState(false)
  const [authStatus, setAuthStatus] = useState<string | null>(null)
  const [connectionAttempted, setConnectionAttempted] = useState(false)
  
  useEffect(() => {
    // Mark that we're on the client
    setIsClient(true)
    
    // Update error if initialError changes
    if (initialError) {
      setError('Failed to connect to QuickBooks')
      setDetailedError(initialError)
    }
    
    // Check for auth params in URL
    const urlParams = new URLSearchParams(window.location.search)
    const status = urlParams.get('auth')
    setAuthStatus(status)
    
    // Handle auth result
    if (status === 'success') {
      console.log('Authentication success detected in connect component')
      // Call the onConnected callback if provided
      if (onConnected) {
        onConnected();
      }
      // Don't clear URL parameters immediately - let other components detect the success
      // Other components will handle URL cleanup after they've processed the auth success
    } else if (status === 'error') {
      const message = urlParams.get('message') || 'Unknown error'
      setError('QuickBooks authentication failed')
      setDetailedError(message)
      
      // After a short delay, clean up the URL
      setTimeout(() => {
        window.history.replaceState({}, document.title, window.location.pathname)
      }, 1000);
    }
    
    // Get the redirect URI for display - only on client
    try {
      const uri = `${window.location.origin}/api/auth/callback`;
      setRedirectUri(uri);
      console.log('Callback URI set to:', uri);
    } catch (err) {
      console.error("Error getting redirect URI:", err);
    }
    
    // Check connection status on load
    checkConnectionStatus();
  }, [initialError, onConnected]);
  
  // Function to check the current connection status
  const checkConnectionStatus = async () => {
    try {
      console.log('Checking QuickBooks connection status...');
      const response = await fetch('/api/auth/status');
      
      if (!response.ok) {
        console.error('Error checking status:', response.status);
        return;
      }
      
      const data = await response.json();
      console.log('Connection status:', data);
      
      if (data.authenticated) {
        setAuthStatus('success');
        // Call the onConnected callback if provided
        if (onConnected) {
          onConnected();
        }
      }
    } catch (err) {
      console.error('Error checking connection status:', err);
    }
  };
  
  const handleConnect = async () => {
    try {
      setIsLoading(true)
      setError(null)
      setDetailedError(null)
      setConnectionAttempted(true)
      
      console.log('Initiating QuickBooks connection...');
      
      // Get QuickBooks authorization URL
      const response = await fetch('/api/auth/quickbooks')
      const data = await response.json();
      
      if (!response.ok) {
        console.error("QuickBooks auth error details:", data);
        throw new Error(data.error || 'Failed to get authorization URL')
      }
      
      const { authUrl, callbackUrl } = data
      console.log("Auth URL generated:", authUrl);
      console.log("Using callback URL:", callbackUrl);
      
      // Explicitly log that we're redirecting to QuickBooks
      console.log("Redirecting to QuickBooks OAuth page...");
      
      // Redirect to QuickBooks authorization page
      window.location.href = authUrl
    } catch (err) {
      console.error('Error connecting to QuickBooks:', err)
      setError('Failed to connect to QuickBooks')
      setDetailedError(err instanceof Error ? err.message : 'Unknown error occurred')
      setIsLoading(false)
    }
  }
  
  const handleDirectInit = () => {
    try {
      setIsLoading(true);
      console.log('Attempting direct QuickBooks initialization for development');
      
      const success = initQuickBooksDirectly();
      
      if (success) {
        // Show success status
        setAuthStatus('success');
      } else {
        setError('Direct initialization failed');
        setDetailedError('Could not initialize QuickBooks with test credentials');
      }
    } catch (err) {
      console.error('Error in direct initialization:', err);
      setError('Direct initialization error');
      setDetailedError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };
  
  // If we just completed auth successfully, show success message with refresh button
  if (authStatus === 'success') {
    return (
      <div className="bg-white rounded-lg shadow-md p-6 max-w-lg mx-auto my-8">
        <div className="flex items-center justify-center mb-4">
          <div className="h-12 w-12 mr-4 flex items-center justify-center bg-green-600 rounded text-white font-bold text-lg">
            ✓
          </div>
          <h2 className="text-2xl font-bold text-gray-800">QuickBooks Connected!</h2>
        </div>
        
        <div className="bg-green-50 p-4 rounded-lg mb-6">
          <p className="text-green-700 font-medium">
            Successfully connected to QuickBooks
          </p>
          <p className="text-green-600 mt-2">
            Your QuickBooks account has been connected. Loading your invoices...
          </p>
        </div>
        
        <div className="flex justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      </div>
    );
  }
  
  const getStorageStatus = () => {
    if (typeof window === 'undefined') return 'Not in browser';
    
    try {
      const token = localStorage.getItem('qb_token');
      const realmId = localStorage.getItem('qb_realm_id');
      const refreshToken = localStorage.getItem('qb_refresh_token');
      const expiryStr = localStorage.getItem('qb_token_expiry');
      
      return {
        hasToken: !!token,
        hasRealmId: !!realmId,
        hasRefreshToken: !!refreshToken,
        tokenExpiry: expi
      };
    } catch (error) {
      console.error('Failed to get storage status:', error);
      return {
        hasToken: false,
        hasRealmId: false,
        hasRefreshToken: false,
        tokenExpiry: 0
      };
    }
  }
  
  // If error display is showing, add a refresh button
  if (error) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6 max-w-lg mx-auto my-8">
        <div className="flex items-center justify-center mb-4">
          <div className="h-12 w-12 mr-4 flex items-center justify-center bg-red-600 rounded text-white font-bold text-lg">
            !
          </div>
          <h2 className="text-2xl font-bold text-gray-800">Connection Error</h2>
        </div>
        
        <div className="bg-red-50 p-4 rounded-lg mb-6">
          <p className="text-red-600 font-medium">{error}</p>
          {detailedError && (
            <div className="mt-2">
              <p className="text-sm text-red-500">Error details:</p>
              <p className="text-sm text-red-500 mt-1">{detailedError}</p>
            </div>
          )}
          <div className="mt-4 text-sm text-gray-600">
            <p>Please make sure:</p>
            <ul className="list-disc pl-5 mt-1 space-y-1">
              <li>Your QuickBooks developer app is properly configured</li>
              <li>The redirect URI is registered correctly in your QuickBooks app settings</li>
              <li>Your environment variables are set correctly</li>
            </ul>
          </div>
        </div>
        
        <div className="flex flex-col gap-3">
          <button
            onClick={handleConnect}
            disabled={isLoading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <span className="inline-block mr-2 h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                Retrying...
              </>
            ) : (
              'Try Again'
            )}
          </button>
          
          <button
            onClick={() => window.location.reload()}
            className="w-full bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium py-3 px-4 rounded-lg transition"
          >
            Refresh Page
          </button>
        </div>
        
        <div className="mt-4 pt-4 border-t border-gray-200">
          <details className="text-sm text-gray-600">
            <summary className="cursor-pointer font-medium">View Connection Troubleshooting</summary>
            <div className="mt-2 p-3 bg-gray-50 rounded">
              <p>If you continue to have issues:</p>
              <ol className="list-decimal pl-5 mt-1 space-y-1">
                <li>Check the browser console for any JavaScript errors</li>
                <li>Verify that your QuickBooks developer credentials are correct</li>
                <li>Check that your browser allows cookies and local storage</li>
                <li>Try using the direct initialization option for development</li>
                <li>Check the server logs for any authentication errors</li>
              </ol>
            </div>
          </details>
        </div>
      </div>
    );
  }
  
  return (
    <div className="bg-white rounded-lg shadow-md p-6 max-w-lg mx-auto my-8">
      <div className="flex items-center justify-center mb-4">
        <div className="h-12 w-12 mr-4 flex items-center justify-center bg-blue-600 rounded text-white font-bold text-lg">
          QB
        </div>
        <h2 className="text-2xl font-bold text-gray-800">Connect to QuickBooks</h2>
      </div>
      
      <div className="bg-blue-50 p-4 rounded-lg mb-6">
        <p className="text-blue-700 font-medium">
          QuickBooks Connection Required
        </p>
        <p className="text-blue-600 mt-2">
          Connect to your QuickBooks account to view and manage your invoices.
        </p>
      </div>
      
      <button
        onClick={handleConnect}
        disabled={isLoading}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed mb-4"
      >
        {isLoading ? (
          <>
            <span className="inline-block mr-2 h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
            Connecting...
          </>
        ) : (
          'Connect to QuickBooks'
        )}
      </button>
      
      <div className="mt-6 pt-6 border-t border-gray-200">
        <details className="text-sm text-gray-600">
          <summary className="cursor-pointer font-medium">For Developers</summary>
          <div className="mt-2 p-3 bg-gray-50 rounded text-xs">
            <p className="font-medium">Setup Instructions:</p>
            <ol className="list-decimal pl-5 mt-1 space-y-2">
              <li>
                Make sure you have registered your app in the <a href="https://developer.intuit.com/app/developer/dashboard" className="text-blue-600 hover:underline" target="_blank" rel="noopener">QuickBooks Developer Dashboard</a>
              </li>
              <li>
                Register this exact callback URL in your app settings:
                <div className="mt-1 p-2 bg-gray-100 rounded break-all" suppressHydrationWarning>
                  {isClient ? redirectUri : 'Loading callback URL...'}
                </div>
              </li>
              <li>
                Ensure your app has the following environment variables: 
                <code className="block mt-1 p-2 bg-gray-100 rounded">
                  QUICKBOOKS_CLIENT_ID<br/>
                  QUICKBOOKS_CLIENT_SECRET<br/>
                  NEXT_PUBLIC_BASE_URL
                </code>
              </li>
            </ol>
          </div>
        </details>
      </div>
      
      <div className="mt-6 pt-6 border-t border-gray-200">
        <details className="text-sm text-gray-600">
          <summary className="cursor-pointer font-medium">Developer Options</summary>
          <div className="mt-2 p-3 bg-gray-50 rounded">
            <p className="text-red-600 text-xs mb-2">⚠️ For development use only:</p>
            <button
              onClick={handleDirectInit}
              className="w-full bg-gray-800 text-white py-2 px-3 rounded text-sm hover:bg-gray-700"
            >
              Initialize with Test Credentials
            </button>
            <p className="text-xs mt-2 text-gray-500">
              This bypasses OAuth and uses fake credentials for development.
            </p>
          </div>
        </details>
      </div>
    </div>
  )
} 