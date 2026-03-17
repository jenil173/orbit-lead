import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  try {
    let privateKey = process.env.FIREBASE_PRIVATE_KEY || '';
    // Strip quotes if they exist
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
      privateKey = privateKey.substring(1, privateKey.length - 1);
    }
    
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey.replace(/\\n/g, '\n'),
      }),
    });
  } catch (error) {
    console.error('Firebase admin initialization error:', error);
  }
}

export const adminAuth = admin.auth();
export const adminDb = admin.firestore();
