import { EvidenceRequest } from "../schemas/evidence-request.schema";
import { Vtr } from "../schemas/ipv-request.schema";

export interface SessionRequestSummary {
    clientId: string;
    redirectUri: string;
    subject: string;
    persistentSessionId: string;
    clientSessionId: string;
    clientIpAddress: string | null;
    state: string;
    evidenceRequested?: EvidenceRequest;
    context?: string;
    vtr?: Vtr;
    storageAccessToken?: string;
}
