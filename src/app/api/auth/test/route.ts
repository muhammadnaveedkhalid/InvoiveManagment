import { NextResponse } from 'next/server'
import { fetchInvoices, checkClientInitialized, manuallyInitializeQuickBooks } from '@/lib/quickbooks/api'

export async function GET(request: Request) {
  try {
    // First check if we're already connected to QuickBooks
    let isConnected;
    try {
      isConnected = checkClientInitialized();
    } catch (error) {
      isConnected = false;
    }
    
    // Log connection status
    console.log('QuickBooks connection status:', isConnected);
    
    if (!isConnected) {
      return NextResponse.json({
        success: false,
        message: 'Not connected to QuickBooks. Please complete the authentication flow first.',
        status: 'disconnected'
      });
    }
    
    // Try to fetch a single invoice to verify connection
    try {
      const invoices = await fetchInvoices();
      
      return NextResponse.json({
        success: true,
        message: 'Successfully connected to QuickBooks',
        status: 'connected',
        invoiceCount: invoices.length,
        sampleInvoice: invoices.length > 0 ? {
          id: invoices[0].id,
          number: invoices[0].invoiceNumber,
          customer: invoices[0].customerName,
          amount: invoices[0].amount
        } : null
      });
    } catch (error) {
      return NextResponse.json({
        success: false,
        message: `Error fetching invoices: ${error instanceof Error ? error.message : 'Unknown error'}`,
        status: 'error_fetching'
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Error in test route:', error);
    return NextResponse.json({
      success: false,
      message: `Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 