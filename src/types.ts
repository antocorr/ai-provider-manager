// ---------------------------------------------------------------------------
// Core entity types
// ---------------------------------------------------------------------------

export type ProviderConfig = {
    id: string;
    userId: string; // "0" = system (SINGLE_PROVIDER_SETTING=true)
    name?: string;
    baseUrl?: string; // for a self-hosted OpenAI-compatible provider
    npm: string; // e.g. "@ai-sdk/anthropic"
    enabled?: boolean;
    currentAuthId?: string; // active ProviderAuth
    createdAt: string; // ISO 8601
    updatedAt: string;
};

export type ProviderAuth = {
    id: string;
    providerConfigId: string; // ProviderConfig.id
    userId: string; // matches ProviderConfig.userId
    type: 'apiKey' | 'oauth' | 'none';
    label?: string; // e.g. "Account free 1", "Token imported Apr 2026"
    data: Record<string, unknown>; // { key } for apiKey; { accessToken, refreshToken, accountId } for oauth
    expiresAt?: string; // optional ISO 8601 timestamp
    createdAt: string;
    updatedAt: string;
};

export type ModelConfig = {
    id: string;
    userId: string;
    providerId: string;
    model: string; // e.g. "gpt-4o"
    options: Record<string, unknown>; // temperature, reasoning budget, top_p, and more
    createdAt: string;
    updatedAt: string;
};

export type ProjectConfig = {
    id: string;
    name: string;
    ownerId: string;
    providerConfigAvailability: 'owner' | 'user' | 'both';
    currentProviderId?: string; // required for "owner" and "both"
    defaultModelId?: string; // required for "owner" and "both"
    userConfigurable?: boolean; // user can choose the model while the provider stays fixed
    userSelectableProvider?: boolean; // user can choose among the owner's providers
    createdAt: string;
    updatedAt: string;
};

export type UserProjectConfig = {
    id: string;
    projectId: string;
    userId: string;
    currentProviderId: string;
    currentModelId: string;
    createdAt: string;
    updatedAt: string;
};

// ---------------------------------------------------------------------------
// Registry types (models.dev/api.json)
// ---------------------------------------------------------------------------

export type RegistryModel = {
    id: string;
    name: string;
    family?: string;
    // Capability flags; these are distinct from values in ModelConfig.options.
    attachment?: boolean;
    reasoning?: boolean; // model supports internal reasoning; options.reasoning is a token budget
    tool_call?: boolean;
    structured_output?: boolean;
    temperature?: boolean; // false means the model ignores temperature; options.temperature is a numeric value
    open_weights?: boolean;
    // Info
    knowledge?: string;
    release_date?: string;
    last_updated?: string;
    status?: 'alpha' | 'beta' | 'deprecated';
    modalities?: {
        input: string[];
        output: string[];
    };
    cost?: {
        input?: number;
        output?: number;
        reasoning?: number;
        cache_read?: number;
        cache_write?: number;
        input_audio?: number;
        output_audio?: number;
    };
    limit?: {
        context?: number;
        input?: number;
        output?: number;
    };
};

export type RegistryProvider = {
    id: string;
    name: string;
    npm: string;
    env: string[];
    api?: string;
    doc?: string;
    models: Record<string, RegistryModel>;
};

export type RegistryCache = {
    updatedAt: string;
    providers: Record<string, RegistryProvider>;
};

// ---------------------------------------------------------------------------
// Resolved configuration returned by getSettings().
// ---------------------------------------------------------------------------

export type ResolvedConfig = {
    baseUrl?: string;
    npm: string;
    model: string;
    options: Record<string, unknown>;
    providerName?: string;
    auth: {
        type: 'apiKey' | 'oauth' | 'none';
        data: Record<string, unknown>;
        expiresAt?: string;
    };
    apiKey?: string; // convenience field set only for apiKey auth
};

// ---------------------------------------------------------------------------
// PlanManager constructor config
// ---------------------------------------------------------------------------

export type RegistryConfig = {
    ttlHours?: number; // default 24
};

// Optional base URLs for the virtual local providers. The library probes these
// daemons live; nothing about them is persisted or cached.
export type LocalProvidersConfig = {
    ollamaLocal?: {
        baseUrl?: string; // default http://127.0.0.1:11434
    };
    llamaCppLocal?: {
        baseUrl?: string; // default http://127.0.0.1:8080
    };
};

export type PlanManagerConfig = {
    singleProviderSetting: boolean;
    // The host owns all persistence, including registry cache.
    storage: import('./storage/IStorage.js').IStorage;
    registry: RegistryConfig;
    // Optional live-local daemons surfaced as virtual providers.
    localProviders?: LocalProvidersConfig;
};
