import { getConfig } from '../config.js';
import { getCookiesForDomain } from '../browser/browser.js';
import { logger } from '../ui/logger.js';

/**
 * Brightspace API client.
 * Uses session cookies from the browser for authentication.
 * All endpoints are relative to the Brightspace base URL.
 *
 * API reference: https://docs.valence.desire2learn.com/
 */

const LE_VERSION = '1.93';
const LP_VERSION = '1.49';

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
}

interface ApiError {
  status: number;
  statusText: string;
  body: string;
}

export class BrightspaceClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = getConfig().BRIGHTSPACE_BASE_URL;
  }

  /**
   * Make an authenticated API request to Brightspace.
   * Cookies are pulled from the active browser session.
   */
  async request<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
    const { method = 'GET', body, headers = {}, timeout = 30_000 } = options;

    // Get session cookies from the browser context
    const domain = new URL(this.baseUrl).hostname;
    const cookies = await getCookiesForDomain(domain);

    if (!cookies) {
      throw new Error('No session cookies available. Login required.');
    }

    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Cookie: cookies,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        const error: ApiError = {
          status: response.status,
          statusText: response.statusText,
          body: errBody,
        };

        if (response.status === 401 || response.status === 403) {
          throw new Error(`Auth error (${response.status}): Session may have expired. ${errBody}`);
        }

        throw new Error(
          `Brightspace API error: ${response.status} ${response.statusText}  - ${errBody}`,
        );
      }

      // Some endpoints return 204 No Content
      if (response.status === 204) {
        return undefined as T;
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        return (await response.json()) as T;
      }

      return (await response.text()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Upload a file via multipart form data.
   * Used for dropbox (assignment) submissions.
   */
  async uploadFile(
    path: string,
    file: { name: string; buffer: Buffer; mimeType: string },
    additionalFields?: Record<string, string>,
  ): Promise<unknown> {
    const domain = new URL(this.baseUrl).hostname;
    const cookies = await getCookiesForDomain(domain);

    if (!cookies) {
      throw new Error('No session cookies available. Login required.');
    }

    const formData = new FormData();

    // Add the file
    const blob = new Blob([new Uint8Array(file.buffer)], { type: file.mimeType });
    formData.append('file', blob, file.name);

    // Add any additional fields
    if (additionalFields) {
      for (const [key, value] of Object.entries(additionalFields)) {
        formData.append(key, value);
      }
    }

    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Cookie: cookies,
      },
      body: formData,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`File upload failed: ${response.status} ${response.statusText}  - ${errBody}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return response.json();
    }
    return response.text();
  }

  // ── Convenience: Learning Platform (LP) ──────────

  /** Get all enrollments for the current user */
  async getMyEnrollments(): Promise<unknown[]> {
    // The enrollment API returns paginated results
    const items: unknown[] = [];
    let bookmark: string | undefined;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const params = bookmark ? `?bookmark=${bookmark}` : '';
      const result = await this.request<{ Items: unknown[]; PagingInfo: { HasMoreItems: boolean; Bookmark: string } }>(
        `/d2l/api/lp/${LP_VERSION}/enrollments/myenrollments/${params}`,
      );

      items.push(...result.Items);

      if (!result.PagingInfo.HasMoreItems) break;
      bookmark = result.PagingInfo.Bookmark;
    }

    return items;
  }

  // ── Convenience: Learning Environment (LE) ───────

  /** Get all dropbox (assignment) folders for a course */
  async getDropboxFolders(orgUnitId: string): Promise<unknown[]> {
    return this.request<unknown[]>(
      `/d2l/api/le/${LE_VERSION}/${orgUnitId}/dropbox/folders/`,
    );
  }

  /** Get a specific dropbox folder */
  async getDropboxFolder(orgUnitId: string, folderId: string): Promise<unknown> {
    return this.request(
      `/d2l/api/le/${LE_VERSION}/${orgUnitId}/dropbox/folders/${folderId}`,
    );
  }

  /** Submit a file to a dropbox folder */
  async submitToDropbox(
    orgUnitId: string,
    folderId: string,
    file: { name: string; buffer: Buffer; mimeType: string },
    comment?: string,
  ): Promise<unknown> {
    return this.uploadFile(
      `/d2l/api/le/${LE_VERSION}/${orgUnitId}/dropbox/folders/${folderId}/submissions/mysubmissions/`,
      file,
      comment ? { comment } : undefined,
    );
  }

  /** Get all quizzes for a course */
  async getQuizzes(orgUnitId: string): Promise<unknown[]> {
    const result = await this.request<{ Objects: unknown[] }>(
      `/d2l/api/le/${LE_VERSION}/${orgUnitId}/quizzes/`,
    );
    return result.Objects ?? [];
  }

  /** Get a specific quiz */
  async getQuiz(orgUnitId: string, quizId: string): Promise<unknown> {
    return this.request(
      `/d2l/api/le/${LE_VERSION}/${orgUnitId}/quizzes/${quizId}`,
    );
  }

  /** Get discussion forums for a course */
  async getDiscussionForums(orgUnitId: string): Promise<unknown[]> {
    return this.request<unknown[]>(
      `/d2l/api/le/${LE_VERSION}/${orgUnitId}/discussions/forums/`,
    );
  }

  /** Get topics in a discussion forum */
  async getDiscussionTopics(orgUnitId: string, forumId: string): Promise<unknown[]> {
    return this.request<unknown[]>(
      `/d2l/api/le/${LE_VERSION}/${orgUnitId}/discussions/forums/${forumId}/topics/`,
    );
  }

  /** Get posts in a discussion topic */
  async getDiscussionPosts(orgUnitId: string, forumId: string, topicId: string): Promise<unknown[]> {
    return this.request<unknown[]>(
      `/d2l/api/le/${LE_VERSION}/${orgUnitId}/discussions/forums/${forumId}/topics/${topicId}/posts/`,
    );
  }

  /** Create a new discussion post */
  async createDiscussionPost(
    orgUnitId: string,
    forumId: string,
    topicId: string,
    post: { Subject: string; Message: { Html: string }; ParentPostId?: number | null },
  ): Promise<unknown> {
    return this.request(
      `/d2l/api/le/${LE_VERSION}/${orgUnitId}/discussions/forums/${forumId}/topics/${topicId}/posts/`,
      { method: 'POST', body: { ...post, IsAnonymous: false } },
    );
  }

  /** Get grade objects for a course */
  async getGradeObjects(orgUnitId: string): Promise<unknown[]> {
    return this.request<unknown[]>(
      `/d2l/api/le/${LE_VERSION}/${orgUnitId}/grades/`,
    );
  }

  /** Get current user's grade for a specific grade object */
  async getMyGrade(orgUnitId: string, gradeObjectId: string): Promise<unknown> {
    return this.request(
      `/d2l/api/le/${LE_VERSION}/${orgUnitId}/grades/${gradeObjectId}/values/myGradeValue`,
    );
  }

  /** Get current user's final calculated grade */
  async getMyFinalGrade(orgUnitId: string): Promise<unknown> {
    return this.request(
      `/d2l/api/le/${LE_VERSION}/${orgUnitId}/grades/final/values/myGradeValue`,
    );
  }

  /** Get content (modules/topics) for a course */
  async getContentRoot(orgUnitId: string): Promise<unknown[]> {
    return this.request<unknown[]>(
      `/d2l/api/le/${LE_VERSION}/${orgUnitId}/content/root/`,
    );
  }

  /** Get content module children */
  async getContentModule(orgUnitId: string, moduleId: string): Promise<unknown> {
    return this.request(
      `/d2l/api/le/${LE_VERSION}/${orgUnitId}/content/modules/${moduleId}/structure/`,
    );
  }
}

// Singleton
let _client: BrightspaceClient | null = null;

export function getBrightspaceClient(): BrightspaceClient {
  if (!_client) {
    _client = new BrightspaceClient();
  }
  return _client;
}
