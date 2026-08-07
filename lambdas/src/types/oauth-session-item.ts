import { SessionItem } from "@govuk-one-login/cri-types";
import { Vtr } from "../schemas/ipv-request.schema";

export interface OAuthSessionItem extends SessionItem {
    vtr?: Vtr;
    storageAccessToken?: string;
}
