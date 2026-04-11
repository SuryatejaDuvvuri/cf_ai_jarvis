export interface GreenhouseJob {
  id: string;
  name: string;
  requisition_id?: string;
  status?: string;
}

export interface GreenhouseCandidate {
  id: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  applications?: Array<{
    id: string;
    jobs?: Array<{ id: number; name: string }>;
  }>;
}

interface GreenhouseClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class GreenhouseClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly authHeader: string;

  constructor(options: GreenhouseClientOptions) {
    this.baseUrl = options.baseUrl ?? "https://harvest.greenhouse.io/v1";
    this.fetchImpl = options.fetchImpl ?? fetch;
    const basic = btoa(`${options.apiKey}:`);
    this.authHeader = `Basic ${basic}`;
  }

  private async request<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Greenhouse request failed (${response.status}): ${text}`
      );
    }

    return (await response.json()) as T;
  }

  async listJobs(): Promise<GreenhouseJob[]> {
    return this.request<GreenhouseJob[]>("/jobs");
  }

  async listCandidates(): Promise<GreenhouseCandidate[]> {
    return this.request<GreenhouseCandidate[]>("/candidates");
  }
}
