from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy import text

from config.settings import settings
from config.database import get_auth_engine

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])

        user_id = payload.get("sub")
        username = payload.get("username")
        full_name = payload.get("full_name")
        role = payload.get("role")
        database_id = payload.get("database_id")

        if user_id is None:
            raise credentials_exception

        return {
            "id": user_id,
            "username": username,
            "email": username,
            "full_name": full_name,
            "role": role or "analyser",
            "database_id": database_id,
        }

    except JWTError:
        raise credentials_exception



def require_super_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user["role"] != "super_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin access required.")
    return current_user


def require_admin_or_supervisor(current_user: dict = Depends(get_current_user)) -> dict:
    role = (current_user.get("role") or "").lower()
    if role not in ["super_admin", "supervisor"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, 
            detail="Admin or Supervisor access required."
        )
    return current_user

