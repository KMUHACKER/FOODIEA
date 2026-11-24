import { Platform } from 'react-native';
import { URL as NativeURL } from 'react-native-url-polyfill';

const URL = Platform.OS === 'web' ? globalThis.URL : NativeURL;

export function apiOrigin(service) {
    const configured = service === 'analysis'
        ? process.env.EXPO_PUBLIC_ANALYSIS_API_URL
        : process.env.EXPO_PUBLIC_RECIPE_API_URL;
    const url = new URL(configured);
    const supportedProtocol = url.protocol === 'https:' || (__DEV__ && url.protocol === 'http:');
    if (!supportedProtocol || !url.hostname || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) {
        throw new Error('Configure an HTTPS API origin.');
    }
    return url.origin;
}

export function recipeImageUrl(value, origin) {
    const url = new URL(value, origin);
    if (url.origin !== origin) throw new Error('Unexpected recipe image origin.');
    return url.href;
}
