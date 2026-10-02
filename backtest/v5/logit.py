import numpy as np
class LogisticRegression:
    """minimal L2 logistic regression (IRLS) on raw features — coefficients are directly usable in JS."""
    def __init__(self, C=1.0, max_iter=100): self.lam = 1.0 / C; self.it = max_iter
    def fit(self, X, y):
        X = np.asarray(X, float); y = np.asarray(y, float)
        mu, sd = X.mean(0), X.std(0); sd[sd == 0] = 1
        Z = np.c_[np.ones(len(X)), (X - mu) / sd]; w = np.zeros(Z.shape[1])
        R = np.eye(Z.shape[1]) * self.lam; R[0, 0] = 0
        for _ in range(self.it):
            p = 1 / (1 + np.exp(-Z @ w)); W = p * (1 - p)
            H = Z.T @ (Z * W[:, None]) + R; gr = Z.T @ (p - y) + R @ w
            step = np.linalg.solve(H, gr); w -= step
            if np.abs(step).max() < 1e-8: break
        self.coef_ = np.array([w[1:] / sd]); self.intercept_ = np.array([w[0] - (w[1:] * mu / sd).sum()])
        return self
    def predict_proba(self, X):
        X = np.asarray(X, float); z = self.intercept_[0] + X @ self.coef_[0]; p = 1 / (1 + np.exp(-z))
        return np.c_[1 - p, p]
