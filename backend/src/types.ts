export interface SessionUser {
  id: string;
  email: string;
  name: string;
  avatarAssetId: string | null;
  createdAt: Date;
}

export type AppEnv = {
  Variables: {
    user: SessionUser;
  };
};
