import type { CapacitorConfig } from '@capacitor/cli';
// quick-261020-google — the single owner of the Google OAuth web client ID; the
// capacitor.config.ts GoogleAuth block below references the same constant.
import { GOOGLE_WEB_CLIENT_ID } from './src/lib/auth/auth-core';

const config: CapacitorConfig = {
	// D-12 LOCKED appId. This is the Android package identity that Obtainium and the
	// Play/sideload update mechanism key on. It is intentionally com.openmusic.app
	// (NOT the com.hectorchanht.musicsquare placeholder from RESEARCH). Changing it
	// after the first signed release breaks update continuity (threat T-999.1-05).
	appId: 'com.openmusic.app',
	appName: 'OpenMusic',
	// adapter-static output (BUILD_TARGET=native pnpm build → build/index.html SPA fallback).
	webDir: 'build',
	android: {
		// Security V14 / T-999.1-04: no cleartext traffic in the WebView. All /api/*
		// metadata and CDN audio bytes go over https. server.androidScheme defaults to
		// 'https' → WebView origin https://localhost (allowlisted in Plan-01 CORS).
		allowMixedContent: false
	},
	plugins: {
		// quick-261020-google — native Google Sign-In via Play Services, NO Firebase.
		// `clientId` is the WEB OAuth client: the plugin's requestIdToken(clientId)
		// mints an ID token with aud = the web client, which /api/auth/google verifies
		// (RS256 + aud/iss/exp/email_verified). Google proves the APP's identity via the
		// registered Android OAuth client (package com.openmusic.app + release SHA-1)
		// in the same GCP project. Survives `npx cap sync android` — config-only, no
		// MainActivity edits.
		GoogleAuth: {
			scopes: ['profile', 'email'],
			serverClientId: GOOGLE_WEB_CLIENT_ID,
			clientId: GOOGLE_WEB_CLIENT_ID,
			forceCodeForRefreshToken: false
		}
	}
};

export default config;
