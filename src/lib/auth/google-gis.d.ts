// quick-261020-google — minimal ambient types for the Google Identity Services web
// button (https://accounts.google.com/gsi/client), loaded lazily on web only. The APK
// never touches this: it uses the Play-Services plugin instead. A .d.ts (not a runtime
// module) so the web bundle stays GIS-free until the script tag loads.

interface GoogleIdCredentialResponse {
	credential?: string;
}

interface GoogleAccountsId {
	initialize(options: {
		client_id: string;
		callback: (response: GoogleIdCredentialResponse) => void;
	}): void;
	renderButton(
		element: HTMLElement,
		options: { theme?: string; size?: string; width?: number; text?: string }
	): void;
}

interface Window {
	google?: {
		accounts?: {
			id?: GoogleAccountsId;
		};
	};
}
