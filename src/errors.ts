export type PlanManagerErrorReason =
    | 'PROJECT_NOT_FOUND'
    | 'USER_NOT_CONFIGURED'
    | 'PROVIDER_NOT_FOUND'
    | 'PROVIDER_AUTH_NOT_FOUND'
    | 'MODEL_NOT_FOUND'
    | 'REGISTRY_UNAVAILABLE'
    | 'LOCAL_PROVIDER_UNAVAILABLE';

export class PlanManagerError extends Error {
    constructor(
        public readonly reason: PlanManagerErrorReason,
        message?: string,
    ) {
        super(message === undefined ? reason : message);
        this.name = 'PlanManagerError';
    }
}
