import { randomUUID } from 'node:crypto';
import { PlanManagerError } from './errors.js';
import { Registry } from './registry/Registry.js';
import type { IStorage } from './storage/IStorage.js';
import type {
    ProviderConfig,
    ProviderAuth,
    ModelConfig,
    ProjectConfig,
    UserProjectConfig,
    ResolvedConfig,
    PlanManagerConfig,
    RegistryCache,
    RegistryProvider,
    RegistryModel,
} from './types.js';

function now(): string {
    return new Date().toISOString();
}

export class PlanManager {
    private readonly storage: IStorage;
    private readonly registry: Registry;
    private readonly singleProviderSetting: boolean;

    constructor(config: PlanManagerConfig) {
        this.singleProviderSetting = config.singleProviderSetting;
        this.storage = config.storage;
        this.registry = new Registry(config.registry, config.storage, config.localProviders);
    }

    // -------------------------------------------------------------------------
    // getSettings — resolve the effective configuration for projectId + userId
    // -------------------------------------------------------------------------

    async getSettings(projectId: string, userId: string): Promise<ResolvedConfig> {
        const project = await this.storage.getProjectConfig(projectId);
        if (!project) throw new PlanManagerError('PROJECT_NOT_FOUND');

        if (this.singleProviderSetting) {
            return this.resolveSystem(project, userId);
        }

        switch (project.providerConfigAvailability) {
            case 'owner': return this.resolveOwner(project, userId);
            case 'user': return this.resolveUser(project, userId);
            case 'both': return this.resolveBoth(project, userId);
        }
    }

    private async resolveAuth(provider: ProviderConfig): Promise<ProviderAuth> {
        if (!provider.currentAuthId) throw new PlanManagerError('PROVIDER_AUTH_NOT_FOUND');
        const auth = await this.storage.getProviderAuth(provider.currentAuthId);
        if (!auth) throw new PlanManagerError('PROVIDER_AUTH_NOT_FOUND');
        return auth;
    }

    private async resolveSystem(project: ProjectConfig, userId: string): Promise<ResolvedConfig> {
        const provider = await this.storage.getProviderConfig('__system__');
        if (!provider) throw new PlanManagerError('PROVIDER_NOT_FOUND');

        const modelId = await this.resolveModelId(project, userId);
        const model = await this.storage.getModelConfig(modelId);
        if (!model) throw new PlanManagerError('MODEL_NOT_FOUND');

        const auth = await this.resolveAuth(provider);
        return toResolvedConfig(provider, auth, model);
    }

    private async resolveOwner(project: ProjectConfig, userId: string): Promise<ResolvedConfig> {
        let providerId: string;
        let modelId: string;

        const userCfg = await this.storage.getUserProjectConfig(project.id, userId);

        if (project.userSelectableProvider) {
            if (userCfg) {
                providerId = userCfg.currentProviderId;
                modelId = userCfg.currentModelId;
            } else {
                providerId = project.currentProviderId!;
                modelId = await this.requireDefaultModelId(project);
            }
        } else {
            providerId = project.currentProviderId!;
            if (userCfg && project.userConfigurable) {
                modelId = userCfg.currentModelId;
            } else {
                modelId = await this.requireDefaultModelId(project);
            }
        }

        const provider = await this.storage.getProviderConfig(providerId);
        if (!provider) throw new PlanManagerError('PROVIDER_NOT_FOUND');

        const model = await this.storage.getModelConfig(modelId);
        if (!model) throw new PlanManagerError('MODEL_NOT_FOUND');

        const auth = await this.resolveAuth(provider);
        return toResolvedConfig(provider, auth, model);
    }

    private async resolveUser(project: ProjectConfig, userId: string): Promise<ResolvedConfig> {
        const userCfg = await this.storage.getUserProjectConfig(project.id, userId);
        if (!userCfg) throw new PlanManagerError('USER_NOT_CONFIGURED');

        const provider = await this.storage.getProviderConfig(userCfg.currentProviderId);
        if (!provider) throw new PlanManagerError('PROVIDER_NOT_FOUND');

        const model = await this.storage.getModelConfig(userCfg.currentModelId);
        if (!model) throw new PlanManagerError('MODEL_NOT_FOUND');

        const auth = await this.resolveAuth(provider);
        return toResolvedConfig(provider, auth, model);
    }

    private async resolveBoth(project: ProjectConfig, userId: string): Promise<ResolvedConfig> {
        const userCfg = await this.storage.getUserProjectConfig(project.id, userId);

        if (userCfg) {
            const provider = await this.storage.getProviderConfig(userCfg.currentProviderId);
            if (!provider) throw new PlanManagerError('PROVIDER_NOT_FOUND');

            const model = await this.storage.getModelConfig(userCfg.currentModelId);
            if (!model) throw new PlanManagerError('MODEL_NOT_FOUND');

            const auth = await this.resolveAuth(provider);
            return toResolvedConfig(provider, auth, model);
        }

        // fallback owner
        const provider = await this.storage.getProviderConfig(project.currentProviderId!);
        if (!provider) throw new PlanManagerError('PROVIDER_NOT_FOUND');

        const modelId = await this.requireDefaultModelId(project);
        const model = await this.storage.getModelConfig(modelId);
        if (!model) throw new PlanManagerError('MODEL_NOT_FOUND');

        const auth = await this.resolveAuth(provider);
        return toResolvedConfig(provider, auth, model);
    }

    private async resolveModelId(project: ProjectConfig, userId: string): Promise<string> {
        const userCfg = await this.storage.getUserProjectConfig(project.id, userId);
        if (userCfg && project.userConfigurable) return userCfg.currentModelId;
        return this.requireDefaultModelId(project);
    }

    private async requireDefaultModelId(project: ProjectConfig): Promise<string> {
        if (!project.defaultModelId) throw new PlanManagerError('MODEL_NOT_FOUND');
        return project.defaultModelId;
    }

    // -------------------------------------------------------------------------
    // Provider
    // -------------------------------------------------------------------------

    async createProviderConfig(
        userId: string,
        data: Omit<ProviderConfig, 'id' | 'userId' | 'createdAt' | 'updatedAt'>,
    ): Promise<ProviderConfig> {
        const config: ProviderConfig = { id: randomUUID(), userId, ...data, createdAt: now(), updatedAt: now() };
        return this.storage.saveProviderConfig(config);
    }

    async updateProviderConfig(
        id: string,
        data: Partial<Omit<ProviderConfig, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>,
    ): Promise<ProviderConfig> {
        const existing = await this.storage.getProviderConfig(id);
        if (!existing) throw new PlanManagerError('PROVIDER_NOT_FOUND');
        return this.storage.saveProviderConfig({ ...existing, ...data, updatedAt: now() });
    }

    async getProviderConfig(id: string): Promise<ProviderConfig | null> {
        return this.storage.getProviderConfig(id);
    }

    async getProvidersByUser(userId: string): Promise<ProviderConfig[]> {
        return this.storage.getProviderConfigsByUser(userId);
    }

    async deleteProviderConfig(id: string): Promise<void> {
        return this.storage.deleteProviderConfig(id);
    }

    // -------------------------------------------------------------------------
    // ProviderAuth
    // -------------------------------------------------------------------------

    async createProviderAuth(
        userId: string,
        providerConfigId: string,
        data: {
            type: 'apiKey' | 'oauth' | 'none';
            label?: string;
            data: Record<string, unknown>;
            expiresAt?: string;
        },
    ): Promise<ProviderAuth> {
        const auth: ProviderAuth = {
            id: randomUUID(),
            providerConfigId,
            userId,
            type: data.type,
            label: data.label,
            data: data.data,
            expiresAt: data.expiresAt,
            createdAt: now(),
            updatedAt: now(),
        };
        await this.storage.saveProviderAuth(auth);
        await this.updateProviderConfig(providerConfigId, { currentAuthId: auth.id });
        return auth;
    }

    async updateProviderAuth(
        id: string,
        data: Partial<Omit<ProviderAuth, 'id' | 'providerConfigId' | 'userId' | 'createdAt' | 'updatedAt'>>,
    ): Promise<ProviderAuth> {
        const existing = await this.storage.getProviderAuth(id);
        if (!existing) throw new PlanManagerError('PROVIDER_AUTH_NOT_FOUND');
        const updated = { ...existing, ...data, updatedAt: now() };
        return this.storage.saveProviderAuth(updated);
    }

    async getProviderAuth(id: string): Promise<ProviderAuth | null> {
        return this.storage.getProviderAuth(id);
    }

    async getProviderAuthsByProviderConfig(providerConfigId: string): Promise<ProviderAuth[]> {
        return this.storage.getProviderAuthsByProviderConfig(providerConfigId);
    }

    async getProviderAuthsByUser(userId: string): Promise<ProviderAuth[]> {
        return this.storage.getProviderAuthsByUser(userId);
    }

    async deleteProviderAuth(id: string): Promise<void> {
        const auth = await this.storage.getProviderAuth(id);
        if (!auth) return;
        await this.storage.deleteProviderAuth(id);
        // Remove the provider reference when this was the active auth.
        const provider = await this.storage.getProviderConfig(auth.providerConfigId);
        if (provider?.currentAuthId === id) {
            await this.storage.saveProviderConfig({ ...provider, currentAuthId: undefined, updatedAt: now() });
        }
    }

    async setActiveProviderAuth(providerConfigId: string, authId: string): Promise<ProviderConfig> {
        const auth = await this.storage.getProviderAuth(authId);
        if (!auth || auth.providerConfigId !== providerConfigId) {
            throw new PlanManagerError('PROVIDER_AUTH_NOT_FOUND');
        }
        return this.updateProviderConfig(providerConfigId, { currentAuthId: authId });
    }

    async setProviderApiKey(
        providerConfigId: string,
        userId: string,
        apiKey: string,
        label?: string,
    ): Promise<ProviderAuth> {
        return this.createProviderAuth(userId, providerConfigId, {
            type: 'apiKey',
            data: { key: apiKey },
            label,
        });
    }

    // No-credential counterpart to setProviderApiKey: marks the provider as
    // needing no auth (e.g. a local daemon). No key is required.
    async setProviderNoAuth(
        providerConfigId: string,
        userId: string,
        label?: string,
    ): Promise<ProviderAuth> {
        return this.createProviderAuth(userId, providerConfigId, {
            type: 'none',
            data: {},
            label,
        });
    }

    async setProviderOauthTokens(
        providerConfigId: string,
        userId: string,
        tokens: {
            accessToken: string;
            refreshToken?: string;
            accountId?: string;
            expiresAt?: string;
        },
        label?: string,
    ): Promise<ProviderAuth> {
        const { expiresAt, ...rest } = tokens;
        return this.createProviderAuth(userId, providerConfigId, {
            type: 'oauth',
            data: rest,
            expiresAt,
            label,
        });
    }

    // -------------------------------------------------------------------------
    // Model
    // -------------------------------------------------------------------------

    async createModelConfig(
        userId: string,
        data: Omit<ModelConfig, 'id' | 'userId' | 'createdAt' | 'updatedAt'>,
    ): Promise<ModelConfig> {
        const config: ModelConfig = { id: randomUUID(), userId, ...data, createdAt: now(), updatedAt: now() };
        return this.storage.saveModelConfig(config);
    }

    async updateModelConfig(
        id: string,
        data: Partial<Omit<ModelConfig, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>,
    ): Promise<ModelConfig> {
        const existing = await this.storage.getModelConfig(id);
        if (!existing) throw new PlanManagerError('MODEL_NOT_FOUND');
        return this.storage.saveModelConfig({ ...existing, ...data, updatedAt: now() });
    }

    async getModelConfig(id: string): Promise<ModelConfig | null> {
        return this.storage.getModelConfig(id);
    }

    async getModelsByUser(userId: string): Promise<ModelConfig[]> {
        return this.storage.getModelConfigsByUser(userId);
    }

    async deleteModelConfig(id: string): Promise<void> {
        return this.storage.deleteModelConfig(id);
    }

    // -------------------------------------------------------------------------
    // Project
    // -------------------------------------------------------------------------

    async createProjectConfig(
        data: Omit<ProjectConfig, 'id' | 'createdAt' | 'updatedAt'>,
    ): Promise<ProjectConfig> {
        const config: ProjectConfig = { id: randomUUID(), ...data, createdAt: now(), updatedAt: now() };
        return this.storage.saveProjectConfig(config);
    }

    async updateProjectConfig(
        id: string,
        data: Partial<Omit<ProjectConfig, 'id' | 'createdAt' | 'updatedAt'>>,
    ): Promise<ProjectConfig> {
        const existing = await this.storage.getProjectConfig(id);
        if (!existing) throw new PlanManagerError('PROJECT_NOT_FOUND');
        return this.storage.saveProjectConfig({ ...existing, ...data, updatedAt: now() });
    }

    async getProject(id: string): Promise<ProjectConfig | null> {
        return this.storage.getProjectConfig(id);
    }

    async deleteProject(id: string): Promise<void> {
        return this.storage.deleteProjectConfig(id);
    }

    // -------------------------------------------------------------------------
    // UserProject
    // -------------------------------------------------------------------------

    async saveUserProjectConfig(
        projectId: string,
        userId: string,
        data: Pick<UserProjectConfig, 'currentProviderId' | 'currentModelId'>,
    ): Promise<UserProjectConfig> {
        const existing = await this.storage.getUserProjectConfig(projectId, userId);
        const config: UserProjectConfig = {
            id: existing ? existing.id : randomUUID(),
            projectId,
            userId,
            ...data,
            createdAt: existing ? existing.createdAt : now(),
            updatedAt: now(),
        };
        return this.storage.saveUserProjectConfig(config);
    }

    async getUserProjectConfig(projectId: string, userId: string): Promise<UserProjectConfig | null> {
        return this.storage.getUserProjectConfig(projectId, userId);
    }

    async deleteUserProjectConfig(projectId: string, userId: string): Promise<void> {
        return this.storage.deleteUserProjectConfig(projectId, userId);
    }

    // -------------------------------------------------------------------------
    // System (SINGLE_PROVIDER_SETTING=true)
    // -------------------------------------------------------------------------

    async saveSystemProvider(
        data: Omit<ProviderConfig, 'id' | 'userId' | 'createdAt' | 'updatedAt'>,
    ): Promise<ProviderConfig> {
        const existing = await this.storage.getProviderConfig('__system__');
        const config: ProviderConfig = {
            id: '__system__',
            userId: '0',
            ...data,
            createdAt: existing ? existing.createdAt : now(),
            updatedAt: now(),
        };
        return this.storage.saveProviderConfig(config);
    }

    async getSystemProvider(): Promise<ProviderConfig | null> {
        return this.storage.getProviderConfig('__system__');
    }

    // -------------------------------------------------------------------------
    // Helper
    // -------------------------------------------------------------------------

    async getOwnerProviders(projectId: string): Promise<ProviderConfig[]> {
        const project = await this.storage.getProjectConfig(projectId);
        if (!project) throw new PlanManagerError('PROJECT_NOT_FOUND');
        return this.storage.getProviderConfigsByUser(project.ownerId);
    }

    // -------------------------------------------------------------------------
    // Registry
    // -------------------------------------------------------------------------

    async updateRegistry(): Promise<void> {
        return this.registry.update();
    }

    async getRegistry(): Promise<RegistryCache> {
        return this.registry.get();
    }

    async getProviders(): Promise<Record<string, RegistryProvider>> {
        return this.registry.getProviders();
    }

    async getModels(providerId?: string): Promise<(RegistryModel & { providerId: string })[]> {
        return this.registry.getModels(providerId);
    }
}

function toResolvedConfig(provider: ProviderConfig, auth: ProviderAuth, model: ModelConfig): ResolvedConfig {
    return {
        baseUrl: provider.baseUrl,
        npm: provider.npm,
        model: model.model,
        options: model.options,
        providerName: provider.name,
        auth: {
            type: auth.type,
            data: auth.data,
            expiresAt: auth.expiresAt,
        },
        apiKey: auth.type === 'apiKey' ? (auth.data.key as string) : undefined,
    };
}
