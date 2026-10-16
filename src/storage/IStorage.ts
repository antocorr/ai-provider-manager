import type {
    ProviderConfig,
    ProviderAuth,
    ModelConfig,
    ProjectConfig,
    UserProjectConfig,
    RegistryCache,
} from '../types.js';

export interface IStorage {
    // Provider — upsert by id
    saveProviderConfig(config: ProviderConfig): Promise<ProviderConfig>;
    getProviderConfig(id: string): Promise<ProviderConfig | null>;
    getProviderConfigsByUser(userId: string): Promise<ProviderConfig[]>;
    deleteProviderConfig(id: string): Promise<void>;

    // ProviderAuth — upsert by id
    saveProviderAuth(auth: ProviderAuth): Promise<ProviderAuth>;
    getProviderAuth(id: string): Promise<ProviderAuth | null>;
    getProviderAuthsByProviderConfig(providerConfigId: string): Promise<ProviderAuth[]>;
    getProviderAuthsByUser(userId: string): Promise<ProviderAuth[]>;
    deleteProviderAuth(id: string): Promise<void>;

    // Model — upsert by id
    saveModelConfig(config: ModelConfig): Promise<ModelConfig>;
    getModelConfig(id: string): Promise<ModelConfig | null>;
    getModelConfigsByUser(userId: string): Promise<ModelConfig[]>;
    getModelConfigsByProvider(providerId: string): Promise<ModelConfig[]>;
    deleteModelConfig(id: string): Promise<void>;

    // Project — upsert by id
    saveProjectConfig(config: ProjectConfig): Promise<ProjectConfig>;
    getProjectConfig(id: string): Promise<ProjectConfig | null>;
    deleteProjectConfig(id: string): Promise<void>;

    // UserProject — upsert by projectId+userId
    saveUserProjectConfig(config: UserProjectConfig): Promise<UserProjectConfig>;
    getUserProjectConfig(projectId: string, userId: string): Promise<UserProjectConfig | null>;
    deleteUserProjectConfig(projectId: string, userId: string): Promise<void>;

    // Registry cache — RegistryCache JSON blob persisted by the host
    getRegistryCache(): Promise<RegistryCache | null>;
    saveRegistryCache(cache: RegistryCache): Promise<void>;
}
