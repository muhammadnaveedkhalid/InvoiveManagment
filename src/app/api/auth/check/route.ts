import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    // Import dynamically to avoid server/client mismatches
    const { checkClientInitialized, tokenStore } = await import('@/lib/quickbooks/api');
    
    // First check if the QuickBooks client is initialized
    let isInitialized = false;
    let initError = null;
    
    try {
      isInitialized = checkClientInitialized();
      console.log('QuickBooks client initialization check result:', isInitialized);
    } catch (error) {
      console.error('Error checking QuickBooks initialization:', error);
      initError = error instanceof Error ? error.message : 'Unknown error during initialization check';
    }
    
    // Check memory store status
    const memoryStoreStatus = {
      hasAccessToken: !!tokenStore.accessToken,
      hasRealmId: !!tokenStore.realmId,
      hasRefreshToken: !!tokenStore.refreshToken,
      tokenExpiry: tokenStore.tokenExpiry ? new Date(tokenStore.tokenExpiry).toISOString() : null
    };
    
    // Test a real API call if initialized
    let apiTest = null;
    if (isInitialized) {
      try {
        // Import the qbo instance directly to make a test call
        const { qbo } = await import('@/lib/quickbooks/api');
        
        // Simple QBO test call
        if (qbo) {
          // Create a promise to handle the callback-style API
          apiTest = await new Promise((resolve, reject) => {
            qbo!.getCompanyInfo(tokenStore.realmId, (err: any, companyInfo: any) => {
              if (err) {
                console.error('Error testing QuickBooks API:', err);
                reject({
                  success: false,
                  error: err.message || 'Unknown API error',
                  fault: err.fault?.type || null,
                  code: err.code || null
                });
              } else {
                resolve({
                  success: true,
                  companyName: companyInfo.CompanyName,
                  legalName: companyInfo.LegalName,
                  industry: companyInfo.Industry
                });
              }
            });
          });
        }
      } catch (apiError) {
        console.error('Error during QuickBooks API test:', apiError);
        apiTest = {
          success: false,
          error: apiError instanceof Error ? apiError.message : 'Unknown error during API test'
        };
      }
    }
    
    return NextResponse.json({
      success: true,
      initialized: isInitialized,
      initError,
      tokenStatus: memoryStoreStatus,
      message: isInitialized 
        ? 'QuickBooks client is initialized and ready' 
        : 'QuickBooks client is not initialized',
      apiTest
    });
  } catch (error) {
    console.error('Error in QuickBooks check endpoint:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error',
        initialized: false
      },
      { status: 500 }
    );
  }
} 