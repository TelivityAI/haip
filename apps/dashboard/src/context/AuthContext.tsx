import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { keycloak, AUTH_ENABLED } from '../lib/keycloak';
import { api } from '../lib/api';

export interface AuthUser {
  sub: string;
  email: string;
  name: string;
  roles: string[];
}

interface AuthContextType {
  user: AuthUser | null;
  roles: string[];
  permissions: string[];
  isAuthenticated: boolean;
  isLoading: boolean;
  authEnabled: boolean;
  logout: () => void;
  hasRole: (...roles: string[]) => boolean;
  hasPermission: (...permissions: string[]) => boolean;
  /** Set the current user's effective permissions (fetched once a property is active). */
  setPermissions: (permissions: string[]) => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  roles: [],
  permissions: [],
  isAuthenticated: false,
  isLoading: true,
  authEnabled: false,
  logout: () => {},
  hasRole: () => true,
  hasPermission: () => true,
  setPermissions: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

/**
 * AuthProvider — wraps the app with Keycloak authentication.
 *
 * When VITE_AUTH_ENABLED=true:
 * - Initializes Keycloak and redirects to login if not authenticated
 * - Attaches Bearer token to all API requests via axios interceptor
 * - Auto-refreshes token before expiry (every 4 minutes)
 * - Provides user info, roles, and logout function
 *
 * When VITE_AUTH_ENABLED=false (default):
 * - Renders children immediately without auth
 * - All role checks return true (unrestricted)
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(AUTH_ENABLED);

  useEffect(() => {
    if (!AUTH_ENABLED) return;

    let refreshInterval: NodeJS.Timeout | undefined;

    keycloak
      .init({
        onLoad: 'login-required',
        pkceMethod: 'S256',
        checkLoginIframe: false,
      })
      .then((authenticated) => {
        if (authenticated && keycloak.tokenParsed) {
          const parsed = keycloak.tokenParsed as any;
          setUser({
            sub: parsed.sub ?? '',
            email: parsed.email ?? '',
            name: parsed.name ?? parsed.preferred_username ?? '',
            roles: parsed.realm_access?.roles ?? [],
          });

          // Set token on axios
          api.defaults.headers.common['Authorization'] = `Bearer ${keycloak.token}`;

          // Auto-refresh every 4 minutes (token expires in 5)
          refreshInterval = setInterval(() => {
            keycloak.updateToken(60).then((refreshed) => {
              if (refreshed) {
                api.defaults.headers.common['Authorization'] = `Bearer ${keycloak.token}`;
              }
            }).catch(() => {
              keycloak.login();
            });
          }, 4 * 60 * 1000);
        }
        setIsLoading(false);
      })
      .catch(() => {
        setIsLoading(false);
      });

    // Intercept 401 responses — redirect to login
    const interceptor = api.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401 && AUTH_ENABLED) {
          keycloak.login();
        }
        return Promise.reject(error);
      },
    );

    return () => {
      if (refreshInterval) clearInterval(refreshInterval);
      api.interceptors.response.eject(interceptor);
    };
  }, []);

  const logout = useCallback(() => {
    if (AUTH_ENABLED) {
      keycloak.logout({ redirectUri: window.location.origin });
    }
  }, []);

  const roles = user?.roles ?? [];

  const hasRole = useCallback(
    (...requiredRoles: string[]) => {
      if (!AUTH_ENABLED) return true;
      if (!user) return false;
      return requiredRoles.some((role) => roles.includes(role));
    },
    [user, roles],
  );

  // Permission-based gating. When auth is disabled (demo), everything is granted.
  const hasPermission = useCallback(
    (...required: string[]) => {
      if (!AUTH_ENABLED) return true;
      return required.every((p) => permissions.includes(p));
    },
    [permissions],
  );

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      roles,
      permissions,
      isAuthenticated: AUTH_ENABLED ? !!user : true,
      isLoading,
      authEnabled: AUTH_ENABLED,
      logout,
      hasRole,
      hasPermission,
      setPermissions,
    }),
    [user, roles, permissions, isLoading, logout, hasRole, hasPermission],
  );

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900 mx-auto" />
          <p className="mt-4 text-sm text-gray-500">Authenticating...</p>
        </div>
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
