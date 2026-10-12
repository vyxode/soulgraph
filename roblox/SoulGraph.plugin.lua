--[[
	SoulGraph — plugin de Roblox Studio / Roblox Studio plugin
	Autor / Author: Vyxode · MIT License · https://github.com/Vyxode/soulgraph

	ES: Envía en vivo la estructura del juego y el código de cada script al panel de SoulGraph
	    (http://localhost:7777) y aplica lo que edites desde allí: código, nombre y atributos.
	    Instalación: copia este archivo a la carpeta de plugins de Studio
	    (pestaña Plugins → "Plugins Folder") y reinicia Studio. La primera vez Studio te
	    pedirá permiso para conectar con localhost: acéptalo.

	EN: Streams the game structure and every script's source to the SoulGraph panel
	    (http://localhost:7777) live, and applies what you edit there: source, name and attributes.
	    Install: copy this file into Studio's plugins folder
	    (Plugins tab → "Plugins Folder") and restart Studio. The first time, Studio will ask
	    for permission to reach localhost: allow it.
]]

local RunService = game:GetService("RunService")
if RunService:IsRunning() then
	return -- solo en el editor, no en Play / editor only, not in Play
end

local HttpService = game:GetService("HttpService")
local ScriptEditorService = game:GetService("ScriptEditorService")
local CollectionService = game:GetService("CollectionService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local Selection = game:GetService("Selection")

-- Cambia el puerto aquí si usas `soulgraph --port`.
-- Change the port here if you run `soulgraph --port`.
local SERVER_URL = "http://localhost:7777"

-- Servicios que se muestran en el grafo / Services shown in the graph
local SERVICES = {
	"Workspace", "ReplicatedStorage", "ReplicatedFirst", "ServerScriptService", "ServerStorage",
	"StarterGui", "StarterPack", "StarterPlayer", "Lighting", "SoundService", "Teams", "TextChatService",
}

-- Profundidad máxima de carpetas/modelos (los scripts se incluyen siempre, estén donde estén).
-- Max depth for folders/models (scripts are always included, wherever they are).
local MAX_CONTAINER_DEPTH = 3
-- Tope de nodos para que un mapa enorme no congele Studio / Node cap so a huge map won't freeze Studio
local MAX_NODES = 4000
-- Tiempo mínimo entre dos escaneos completos / Minimum time between two full scans
local MIN_SCAN_INTERVAL = 2
-- Tamaño máximo de cada envío de código / Max size of each source upload
local MAX_BATCH_BYTES = 400000

local CONTAINER_CLASSES = {
	Folder = true, Model = true, Actor = true, Configuration = true,
	ScreenGui = true, SurfaceGui = true, BillboardGui = true,
	StarterPlayerScripts = true, StarterCharacterScripts = true,
}

---------------------------------------------------------------------
-- Estado / State
---------------------------------------------------------------------

local alive = true
local enabled = plugin:GetSetting("SoulGraphEnabled")
if enabled == nil then
	enabled = true
end

local byId = {} -- id → Instance
local sentSource = setmetatable({}, { __mode = "k" }) -- script → último código enviado / last source sent
local watchConnections = {}
local dirty = true
local lastScan = 0
local online = false

---------------------------------------------------------------------
-- Barra de herramientas / Toolbar
---------------------------------------------------------------------

local toolbar = plugin:CreateToolbar("SoulGraph")
local button = toolbar:CreateButton(
	"SoulGraph",
	"Sincroniza Studio con el panel SoulGraph (localhost) / Sync Studio with the SoulGraph panel (localhost)",
	""
)
button.ClickableWhenViewportHidden = true
button:SetActive(enabled)

button.Click:Connect(function()
	enabled = not enabled
	plugin:SetSetting("SoulGraphEnabled", enabled)
	button:SetActive(enabled)
	if enabled then
		dirty = true
	end
end)

---------------------------------------------------------------------
-- HTTP
---------------------------------------------------------------------

-- Devuelve la respuesta ya decodificada, o nil si el servidor no está.
-- Returns the decoded response, or nil if the server isn't there.
local function request(method, path, body)
	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = SERVER_URL .. path,
			Method = method,
			Headers = { ["Content-Type"] = "application/json" },
			Body = body and HttpService:JSONEncode(body) or nil,
		})
	end)

	if not ok or not response.Success then
		if online then
			online = false
			warn("[SoulGraph] Sin conexión con el panel / Lost connection to the panel")
		end
		return nil
	end

	if not online then
		online = true
		dirty = true -- al volver, reenviamos el árbol completo / on reconnect, resend the whole tree
		print("[SoulGraph] Conectado / Connected → " .. SERVER_URL)
	end

	local decoded = nil
	pcall(function()
		decoded = HttpService:JSONDecode(response.Body)
	end)
	return decoded or {}
end

---------------------------------------------------------------------
-- Escaneo del árbol / Tree scan
---------------------------------------------------------------------

local function isScript(instance)
	return instance:IsA("LuaSourceContainer")
end

local function markDirty()
	dirty = true
end

-- Atributos como { valor, tipo }; los tipos complejos (Vector3, Color3...) van como texto.
-- Attributes as { value, type }; complex types (Vector3, Color3...) are sent as text.
local function attributesOf(instance)
	local result = nil
	for key, value in pairs(instance:GetAttributes()) do
		result = result or {}
		local kind = typeof(value)
		if kind == "string" or kind == "number" or kind == "boolean" then
			result[key] = { value = value, type = kind }
		else
			result[key] = { value = tostring(value), type = kind }
		end
	end
	return result
end

local function scan()
	for _, connection in ipairs(watchConnections) do
		connection:Disconnect()
	end
	table.clear(watchConnections)
	table.clear(byId)

	local nodes = {}
	local included = {}

	-- Añade una instancia y, antes, a todos sus padres (para que el árbol quede unido).
	-- Adds an instance, and all its parents first (so the tree stays connected).
	local function add(instance)
		if included[instance] or #nodes >= MAX_NODES then
			return
		end
		included[instance] = true

		local parent = instance.Parent
		local parentId = nil
		if parent and parent ~= game then
			add(parent)
			parentId = parent:GetDebugId()
		end

		local id = instance:GetDebugId()
		byId[id] = instance

		local tags = CollectionService:GetTags(instance)
		table.insert(nodes, {
			id = id,
			name = instance.Name,
			class = instance.ClassName,
			parent = parentId,
			children = #instance:GetChildren(),
			runContext = instance:IsA("Script") and instance.RunContext.Name or nil,
			disabled = instance:IsA("BaseScript") and not instance.Enabled or nil,
			attrs = attributesOf(instance),
			tags = #tags > 0 and tags or nil,
		})

		-- Renombrar o cambiar atributos también actualiza el grafo.
		-- Renaming or changing attributes also updates the graph.
		table.insert(watchConnections, instance:GetPropertyChangedSignal("Name"):Connect(markDirty))
		table.insert(watchConnections, instance.AttributeChanged:Connect(markDirty))
	end

	local function addContainers(instance, depth)
		if depth > MAX_CONTAINER_DEPTH then
			return
		end
		for _, child in ipairs(instance:GetChildren()) do
			if CONTAINER_CLASSES[child.ClassName] then
				add(child)
				addContainers(child, depth + 1)
			end
		end
	end

	for _, serviceName in ipairs(SERVICES) do
		-- FindService no crea el servicio si no existe / FindService won't create a missing service
		local service = game:FindService(serviceName)
		if service then
			add(service)
			addContainers(service, 1)
			for _, descendant in ipairs(service:GetDescendants()) do
				if isScript(descendant) then
					add(descendant)
				end
			end
			task.wait() -- deja respirar a Studio entre servicios / let Studio breathe between services
		end
	end

	if #nodes >= MAX_NODES then
		warn(("[SoulGraph] Se alcanzó el tope de %d nodos / Reached the %d node cap"):format(MAX_NODES, MAX_NODES))
	end
	return nodes
end

local function sendTree()
	lastScan = os.clock()
	dirty = false
	local nodes = scan()
	local response = request("POST", "/api/studio/tree", { place = game.Name, nodes = nodes })
	if not response then
		dirty = true
		return
	end
	-- El servidor nos dice qué código le falta / The server tells us which sources it's missing
	for _, id in ipairs(response.need or {}) do
		local instance = byId[id]
		if instance then
			sentSource[instance] = nil
		end
	end
end

-- Envía el código que haya cambiado, incluido lo que estás escribiendo sin guardar.
-- Sends any source that changed, including what you're typing but haven't committed.
local function sendSources()
	local batch, batchScripts, batchBytes = {}, {}, 0

	local function flush()
		if #batch == 0 then
			return true
		end
		if not request("POST", "/api/studio/sources", { items = batch }) then
			return false
		end
		for i, instance in ipairs(batchScripts) do
			sentSource[instance] = batch[i].source
		end
		batch, batchScripts, batchBytes = {}, {}, 0
		return true
	end

	for id, instance in pairs(byId) do
		if isScript(instance) and instance.Parent then
			local ok, source = pcall(ScriptEditorService.GetEditorSource, ScriptEditorService, instance)
			if ok and sentSource[instance] ~= source then
				table.insert(batch, { id = id, source = source })
				table.insert(batchScripts, instance)
				batchBytes += #source
				if batchBytes > MAX_BATCH_BYTES and not flush() then
					return
				end
			end
		end
	end
	flush()
end

---------------------------------------------------------------------
-- Órdenes del panel / Panel commands
---------------------------------------------------------------------

local function withUndo(label, action)
	local recording = ChangeHistoryService:TryBeginRecording("SoulGraph: " .. label)
	local ok, err = pcall(action)
	if recording then
		ChangeHistoryService:FinishRecording(
			recording,
			ok and Enum.FinishRecordingOperation.Commit or Enum.FinishRecordingOperation.Cancel
		)
	end
	if not ok then
		warn("[SoulGraph] " .. label .. ": " .. tostring(err))
	end
end

local function applyCommand(command)
	local instance = byId[command.id]
	if not instance or not instance.Parent then
		warn("[SoulGraph] Ya no existe / No longer exists: " .. tostring(command.id))
		return
	end

	if command.type == "source" and isScript(instance) then
		withUndo("editar " .. instance.Name, function()
			-- UpdateSourceAsync respeta el editor abierto y la edición colaborativa.
			-- UpdateSourceAsync respects the open editor and collaborative editing.
			ScriptEditorService:UpdateSourceAsync(instance, function()
				return command.source
			end)
		end)
		sentSource[instance] = command.source
	elseif command.type == "props" then
		withUndo("propiedades " .. instance.Name, function()
			if type(command.name) == "string" and command.name ~= "" then
				instance.Name = command.name
			end
			for key, value in pairs(command.attrs or {}) do
				local current = instance:GetAttribute(key)
				-- Solo tocamos atributos simples y sin cambiarles el tipo / Simple attributes only, same type
				if current == nil or typeof(current) == typeof(value) then
					instance:SetAttribute(key, value)
				end
			end
		end)
	elseif command.type == "open" then
		Selection:Set({ instance })
		if isScript(instance) then
			plugin:OpenScript(instance)
		end
	end
end

---------------------------------------------------------------------
-- Bucles / Loops
---------------------------------------------------------------------

-- Cualquier script o contenedor que aparezca o desaparezca pide un nuevo escaneo.
-- Any script or container appearing or disappearing asks for a new scan.
local function watchService(service)
	local function onChange(instance)
		if isScript(instance) or CONTAINER_CLASSES[instance.ClassName] then
			dirty = true
		end
	end
	service.DescendantAdded:Connect(onChange)
	service.DescendantRemoving:Connect(onChange)
end

for _, serviceName in ipairs(SERVICES) do
	local service = game:FindService(serviceName)
	if service then
		watchService(service)
	end
end

-- Sincronización: árbol cuando cambia, código cada segundo.
-- Sync: tree when it changes, sources every second.
task.spawn(function()
	while alive do
		if enabled and not online then
			-- Un ping barato antes de escanear, para no recorrer el mapa sin servidor.
			-- A cheap ping before scanning, so we don't walk the map with no server.
			request("GET", "/api/studio/ping")
		end
		if enabled and online then
			if dirty and os.clock() - lastScan >= MIN_SCAN_INTERVAL then
				sendTree()
			end
			if not dirty then
				sendSources()
			end
		end
		task.wait(online and 1 or 5)
	end
end)

-- Órdenes: el servidor mantiene la petición abierta hasta que haya algo (long polling).
-- Commands: the server holds the request open until there's something (long polling).
task.spawn(function()
	while alive do
		if enabled and online then
			local commands = request("GET", "/api/studio/poll")
			if commands then
				for _, command in ipairs(commands) do
					applyCommand(command)
				end
			else
				task.wait(5)
			end
		else
			task.wait(1)
		end
	end
end)

plugin.Unloading:Connect(function()
	alive = false
	for _, connection in ipairs(watchConnections) do
		connection:Disconnect()
	end
end)
