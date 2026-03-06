# Mi Legajo — Automatizador de Horas Extras

Esta aplicación te permite cargar de forma masiva tus horas extras en el sistema de legajos de la empresa, evitando la monótona tarea de subirlas día por día.

La app levanta una interfaz web moderna, minimalista y segura (PWA). Cuando ingresás los días y la franja horaria (Inicio/Fin), un bot en segundo plano (Playwright) abre un navegador Chromium invisible, se autentica en la plataforma, busca el formulario dinámico y completa los registros automáticamente por vos.

## 🚀 Características Principales
*   **Gestión Masiva:** Agregá todas las filas que quieras y envialas en 1 solo click.
*   **Cálculo Automático:** Seleccioná la hora de inicio y fin, y el sistema calculará exactamente las horas.
*   **Configuración Personalizable:** Definí las "Tareas a realizar" y el "Horario Laboral Habitual" directamente desde la interfaz.
*   **Historial Local (SQLite):** Todo se guarda localmente para que puedas consultar envíos viejos en la pestaña Historial.
*   **Seguridad JWT:** Sesiones seguras para la PWA sin localStorage, previniendo secuestros de sesión.
*   **PWA Ready:** Podés instalar la app directamente en tu celular Android/iOS para usarla como una app nativa.
*   **Optimizado para TrueNAS:** Imagen Alpine hiper-liviana con usuario no-root mapeado a `apps` (UID 568).

## 🐋 Cómo desplegar en TrueNAS (Custom App)

La aplicación está diseñada para desplegarse fácilmente bajo TrueNAS Scale utilizando Docker / Custom Apps.

1. **Creá la Custom App** apuntando a la imagen de Docker Hub (ej: `tu-repo/legajo-automator:latest`).
2. **Configurar Entorno (Obligatorio en TrueNAS UI):** La aplicación está asegurada para que nadie en tu red local pueda entrar. A su vez, necesita tus credenciales del portal. 
   Configurá estas **4 variables de entorno** en la sección correspondiente de la interfaz de TrueNAS (tal como figuran vacías en el `docker-compose.yml`):
   * `APP_USERNAME`: Tu usuario elegido para ver la pantalla de la app (ej: `admin`).
   * `APP_PASSWORD`: Tu contraseña para ver la pantalla de la app.
   * `LEGAJO_USER`: Tu correo electrónico o legajo de la empresa (CUIT).
   * `LEGAJO_PASS`: Tu contraseña de la empresa en *tulegajo.com*.
   * *Opcional:* `LEGAJO_URL`: Solo si la URL de login de la empresa cambia (por defecto es `https://app.tulegajo.com/login.htm`).
3. **Persistencia (Volúmenes):** Mapeá el directorio `/app/data` del contenedor a un Dataset de TrueNAS (Ej: `/mnt/pool/data/legajo-app/data:/app/data`). **Crucial:** Asegurate que el Dataset pertenezca al usuario `apps` (UID 568).
4. **Mapeo de Red:** El contenedor expone el puerto `8080` (TCP). Mapealo a un puerto libre de tu host TrueNAS (ej: Node Port `48080`).
5. Abrí la página en tu navegador (ej: `http://192.168.1.50:48080`).

## 💻 Desarrollo Local (Docker Compose)

Si querés correr la app en tu propia PC para hacer pruebas:

1. Cloná este repositorio.
2. (Opcional) Copiá el `.env.example` a `.env` y llená tus variables de entorno para no tener que escribirlas manualmente al hacer "test login".
3. Ejecutá:
```bash
docker compose up -d --build
```
4. Ingresá a `http://localhost:48080`.

## 📱 Instalación PWA (Móvil)
Una vez desplegada la aplicación, abrila desde el navegador de tu celular (ej. Chrome o Safari).
*   **En Android:** Abrí el menú de Chrome y seleccioná "Instalar aplicación" o "Agregar a la pantalla de inicio".
*   **En iOS:** Abrí el menú de Compartir de Safari y seleccioná "Agregar a inicio".

¡La app se abrirá en pantalla completa y 100% responsiva para cargar tus horas desde la cama!
