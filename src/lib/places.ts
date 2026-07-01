import type { Env } from '../env';

export interface Place {
  name: string;
  website: string | null;
  phone: string | null;
  address: string | null;
}

interface PlacesResponse {
  places?: {
    displayName?: { text?: string };
    websiteUri?: string;
    internationalPhoneNumber?: string;
    formattedAddress?: string;
  }[];
  nextPageToken?: string;
}

/**
 * Google Places Text Search (New), up to 3 pages per query.
 * Field mask per spec + nextPageToken (required for pagination).
 */
export async function placesTextSearch(env: Env, query: string): Promise<Place[]> {
  if (!env.GOOGLE_PLACES_API_KEY) throw new Error('GOOGLE_PLACES_API_KEY not configured');
  const results: Place[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 3; page++) {
    const body: Record<string, string> = { textQuery: query };
    if (pageToken) body.pageToken = pageToken;
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask':
          'places.displayName,places.websiteUri,places.internationalPhoneNumber,places.formattedAddress,places.location,nextPageToken',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`places search failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as PlacesResponse;
    for (const p of data.places ?? []) {
      results.push({
        name: p.displayName?.text ?? '',
        website: p.websiteUri ?? null,
        phone: p.internationalPhoneNumber ?? null,
        address: p.formattedAddress ?? null,
      });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return results.filter((p) => p.name);
}
