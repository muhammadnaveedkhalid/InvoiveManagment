import { NextResponse } from 'next/server'
import { getAuthUrl } from '@/lib/quickbooks/api'

export async function GET(req: Request) {
  try {
    // Debug logging
    console.log('QuickBooks Auth Debug:', {
      clientIdExists: !!process.env.QUICKBOOKS_CLIENT_ID,
      clientSecretExists: !!process.env.QUICKBOOKS_CLIENT_SECRET,
      baseUrl: process.env.NEXT_PUBLIC_BASE_URL,
      redirectUri: process.env.QUICKBOOKS_REDIRECT_URI,
      nodeEnv: process.env.NODE_ENV
    });

    // Display the actual redirect URI for debugging
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || req.headers.get('host')
    const callbackUrl = `${baseUrl}/api/auth/callback`
    
    console.log('Generating auth URL with callback:', callbackUrl);
    
    const authUrl = getAuthUrl()
    
    // Log the generated URL
    console.log('Generated auth URL:', authUrl);
    
    return NextResponse.json({ 
      authUrl, 
      callbackUrl,
      debug: {
        clientIdSet: !!process.env.QUICKBOOKS_CLIENT_ID,
        clientSecretSet: !!process.env.QUICKBOOKS_CLIENT_SECRET,
        baseUrl: process.env.NEXT_PUBLIC_BASE_URL,
        redirectUri: callbackUrl
      }
    })
  } catch (error) {
    console.error('Error generating QuickBooks auth URL:', error)
    
    // Provide more detailed error information
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { 
        error: 'Failed to generate QuickBooks authorization URL',
        details: errorMessage,
        help: "Ensure your QuickBooks API credentials are set correctly in your environment variables",
        required: {
          clientId: process.env.QUICKBOOKS_CLIENT_ID ? "Set" : "Missing",
          clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET ? "Set" : "Missing",
          redirectUri: process.env.NEXT_PUBLIC_BASE_URL ? `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/callback` : "Missing base URL"
        }
      },
      { status: 500 }
    )
  }
} 