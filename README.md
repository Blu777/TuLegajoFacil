# Mi Legajo — Automatizador de Horas Extras

Esta aplicación te permite cargar de forma masiva tus horas extras en el sistema de legajos de la empresa, evitando la monótona tarea de subirlas día por día.

La app levanta una interfaz web moderna y minimalista. Cuando presionás "Enviar", un bot en segundo plano (Playwright) abre un navegador Chromium invisible, se autentica en la plataforma, y completa el formulario automáticamente por vos.

## 🚀 Requisitos

- **Docker** y **Docker Compose** instalados en tu máquina (o servidor).

## 🐋 Cómo ejecutar la aplicación

## 🐋 Cómo desplegar en TrueNAS (Custom App)

1. **Subir los archivos** al pool de tu TrueNAS (o tener el directorio mapeado si usás Portainer/Docker interactivo).
2. **Configurar Entorno (Obligatorio en TrueNAS UI):** La aplicación está asegurada con Basic Auth para que nadie en tu red local pueda entrar. A su vez, necesita tus credenciales del portal. 
   Al crear la **Custom App** o lanzar la imagen, asegurate de **cargar estas 5 variables de entorno** (Environment Variables) en la sección correspondiente de la interfaz de TrueNAS (tal como figuran vacías en el `docker-compose.yml`):
   * `APP_USERNAME`: Tu usuario elegido para ver la pantalla de la app (ej: `admin`).
   * `APP_PASSWORD`: Tu contraseña para ver la pantalla de la app.
   * `LEGAJO_USER`: Tu correo electrónico o legajo de la empresa.
   * `LEGAJO_PASS`: Tu contraseña de la empresa.
   * `LEGAJO_URL`: (Ya viene predefinida en el YAML como `https://app.tulegajo.com/login.htm`).
3. **Mapeo de Red:** El contenedor expone el puerto `8080`. Mapealo a un puerto libre de tu host TrueNAS (ej: `8080:8080`).
4. **Desplegar y arrancar**.
5. Abrir la página en tu navegador insertando la IP de TrueNAS (se te pedirá el usuario y contraseña de *Basic Auth* que configuraste):
   🔗 `http://[IP_TRUENAS]:8080`

---

## 🛠️ PASO FINAL: Conectar la automatización con la página de tu empresa

Aunque la arquitectura ya está completa, **necesitamos indicarle al script exactamente dónde hacer click.**
Actualmente, el archivo `backend/automation.py` está lleno de "stubs" temporales (`# ← COMPLETAR`).

Para que yo pueda escribir la lógica definitiva, necesito que entres al navegador y me pases los **Selectores CSS** de los elementos de la página (`https://app.tulegajo.com/home.htm`).

### ¿Cómo obtener los selectores? (Instrucciones)

1. Abrí tu navegador (Chrome o Firefox) y entrá a **`https://app.tulegajo.com/home.htm`** (si la página de login es diferente, avisame).
2. Apretá la tecla `F12` para abrir las **DevTools** (Herramientas de desarrollador).
3. Hacé click en el **ícono del cursor en un cuadradito** (arriba a la izquierda del panel F12). Esto te permite seleccionar elementos en la página.
4. **Hacé click en el campo de "Usuario"** (donde ponés tu email/DNI).
5. En el panel F12 vas a ver que resalta una línea de código HTML como `<input id="username" class="form-control" name="user" ...>`.
6. Hacé **click derecho** sobre esa línea resaltada > **Copy** (Copiar) > **Copy selector** (Copiar selector).
7. Pegá ese selector en el chat para pasármelo.

#### Necesito que repitas ese paso de "Copiar Selector" para las siguientes cosas:

**En la pantalla de Login:**
* [ ] Campo del Usuario/Email
* [ ] Campo de la Contraseña
* [ ] Botón de "Iniciar Sesión"

**En la pantalla principal (una vez que hacés login):**
* [ ] El botón o menú que tenés que apretar para ir a la sección de "Cargar Horas". _(Nota: Si cuando hacés login vas directo al formulario, omití este paso)_.

**En el Formulario de Carga de Horas:**
* [ ] El campo donde se ingresa la **Fecha** (¿Es un calendario, o se puede escribir? ¿Qué formato de fecha te pide? Ej: `DD/MM/YYYY`)
* [ ] El campo donde se escriben las **Horas**
* [ ] El botón para "Guardar", "Enviar" o "Aceptar" la carga de ese día
* [ ] Un cartel o elemento de éxito que aparezca en pantalla para darnos cuenta que se guardó bien (ej: una barrita verde que dice "Guardado exitosamente").

¡Pasame esos selectores acá por el chat y automáticamente reescribiré `backend/automation.py` para que conecte prefecto con tu sistema!
