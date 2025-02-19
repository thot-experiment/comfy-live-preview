const URL = window.location.host
//USER INTENT
let prev_intent_hash = ""
const intent = {
  active_output: 0,
  focus: "",
  view_mode: "fullscreen",
}

const hash_text = (bytes => {
  const has_crypto = crypto.subtle
  const enc = has_crypto ? new TextEncoder() : null
  return string =>
    has_crypto
      ? crypto.subtle
          .digest("SHA-256", enc.encode(string))
          .then(a =>
            [...new Uint8Array(a).slice(0, bytes)]
              .map(n => ("00" + n.toString(16)).slice(-2))
              .join("")
          )
      : (str => {
          let hash = 19375491
          for (let i = 0; i < str.length; i++) {
            hash = (hash << 5) + hash + str.charCodeAt(i)
          }
          return Math.abs(hash * 133541)
            .toString(16)
            .slice(0, bytes * 2)
        })(string)
})(4)

let images = []

const zip = (...arrays) =>
  Array.from({length: Math.max(...arrays.map(a => a?.length))}, (_, i) =>
    arrays.map(a => a[i])
  )

const zip_min = (...arrays) =>
  Array.from({length: Math.min(...arrays.map(a => a?.length))}, (_, i) =>
    arrays.map(a => a[i])
  )

//use a symbol as the falsy-case here because it's guaranteed to be unique
const all_same = (array, f = Symbol()) =>
  array.reduce((a, b) => (JSON.stringify(a) == JSON.stringify(b) ? a : f)) !== f

const debug_workflow = w => {
  const g_c = w.groups.length
  const n_c = w.nodes.length
  const l_c = w.links.length
  console.log(`n:${n_c} g:${g_c} l:${l_c}`)
}

const image_to_favicon = url => {
  const canvas = document.createElement("canvas")
  canvas.width = 16
  canvas.height = 16
  const ctx = canvas.getContext("2d")

  const img = document.createElement("img")
  img.src = url
  img.onload = () => {
    ctx.drawImage(img, 0, 0, 16, 16)
    const link = document.createElement("link")
    link.id = "favicon"
    link.type = "image/x-icon"
    link.rel = "shortcut icon"
    link.href = canvas.toDataURL("image/x-icon")
    const head = document.getElementsByTagName("head")[0]
    const favicon = head.querySelector("#favicon")
    if (favicon) {
      favicon.replaceWith(link)
    } else {
      head.appendChild(link)
    }
  }
}

//we don't deep compare, just return any nodes that have had any changes to the widget values in the history
const compare_workflows = workflows => {
  const changed_nodes = []

  for (const id of new Set(workflows.map(w => w.nodes.map(n => n.id)).flat())) {
    const same_nodes = workflows.map(w => w.nodes.find(n => n.id == id))
    const mode_changed = !all_same(same_nodes.map(a => a?.mode))
    const {type, mode} = same_nodes.filter(a => a)[0]
    const widgets_values = same_nodes.map(n => n?.widgets_values)
    const changes = Object.entries(zip(...widgets_values)).filter(
      ([k, v]) => !all_same(v)
    )
    if ((mode_changed || changes.length) && mode === 0)
      changed_nodes.push({type, id, changes, mode_changed, nodes: same_nodes})
  }

  return changed_nodes
}

const image_url = image => {
  const req = Object.entries(image)
    .filter(([k]) => ["filename", "subfolder", "type"].includes(k))
    .map(a => a.join("="))
    .join("&")
  return `http://${URL}/view?${req}`
}

const handle_key_press = event => {
  console.log(event.key)
  if (event.key === "ArrowLeft") {
    intent.active_output--
  } else if (event.key === "ArrowRight") {
    intent.active_output++
  } else if (event.key === "ArrowUp") {
    intent.move_history = 1
  } else if (event.key === "ArrowDown") {
    intent.move_history = -1
  } else if (event.key === "F") {
    intent.view_mode = "grid"
    intent.grid_mode = intent.grid_mode === undefined?0:intent.grid_mode+1
  } else if (event.key === "f") {
    intent.view_mode = intent.view_mode === "fullscreen" ? "grid" : "fullscreen"
  } else if (event.key === "Escape") {
    intent.abs_history = -1
  }
}

document.addEventListener("keydown", handle_key_press)

//returns a promise that returns a div, only gets generated once then cached
const lazy_image_div = image => {
  const url = image_url(image)
  return {
    get div() {
      delete this.div
      const div = document.createElement("div")
      div.classList.add("imag")
      div.style.backgroundImage = `url(${url})`
      this.div = div
      return this.div
    },
    url,
    image,
  }
}

const make_grid = (
  {width, height, x_keys, y_keys, x_title, y_title, grid},
  get_image_div
) => {
  const render_t = header => (v, i) => {
    if (header || i === 0) {
      const th = document.createElement("th")
      if (i === 0) {
        th.classList.add("row-header")
      } else {
        th.classList.add("top-header")
      }
      th.innerHTML = `<span>${JSON.stringify(v)}</span>`
      return th
    } else {
      const td = document.createElement("td")

      if (v) {
        const url = get_image_div(v)
        /*
        td.style.background = `url(${url}) no-repeat center center`
        td.style.backgroundSize = `contain`
        */
        const img = document.createElement('img')
        img.src = url
        td.appendChild(img)
      }
      return td
    }
  }
  const headers = [`${x_title}<br>vs<br>${y_title}`, ...x_keys].map(
    render_t(true)
  )
  const rows = [
    headers,
    ...grid.map((row, i) => [y_keys[i], ...row].map(render_t())),
  ]
  const table = document.createElement("table")
  const tbody = document.createElement("tbody")
  rows.forEach(row => {
    const tr = document.createElement("tr")
    row.forEach(e => tr.appendChild(e))
    tbody.appendChild(tr)
  })

  table.appendChild(tbody)

  return table
}

const HistoryCache = (history_json = {}) => {
  //validate and unpack history entry
  const parse_hist = (id, gen) => {
    const is_valid =
      gen.status.status_str === "success" && gen.status.completed === true
    if (!is_valid) return
    const {outputs, prompt} = gen
    //transforms image outputs into {images:[...], files?: [...], id: int}
    const workflow = prompt.find(a => a.extra_pnginfo)?.extra_pnginfo?.workflow
    const images = new Map(
      Object.entries(outputs)
        .filter(([, n]) => n.images?.length)
        .map(([k, n]) => {
          n.node = workflow.nodes.find(a => a.id == k)
          n.id = parseInt(k)
          n.images = n.images.map(lazy_image_div)
          return [k, n]
        })
        .sort(
          ([, {node: a}], [, {node: b}]) =>
            parseFloat(a.title) - parseFloat(b.title)
        )
    )

    return {id, images, workflow, prompt, raw: gen}
  }

  //init based on the history json, can be empty
  const history = new Map(
    Object.entries(history_json)
      .map(([k, v]) => [k, parse_hist(k, v)])
      .filter(([k, v]) => v)
  )
  const get = history.get.bind(history)

  //keep keys in chronological order for efficient access
  //(can't get the last key in a map without iteration)
  const keys = [...history.keys()]

  //validated set that updates keys
  const set = (key, value) => {
    const ph = parse_hist(key, value)
    if (ph) {
      history.set(key, ph)
      keys.includes(key) ? null : keys.push(key)
    }
  }

  //we keep the key array in order to be able to do this
  const latest = () => get(keys.at(-1)) || {}

  //merge in a new history_json without ovewriting old data
  //TODO check whether there can be partial history entries
  //that may later be completed, if true this needs to take that into account
  const push = history_json =>
    Object.entries(history_json).forEach(([k, v]) =>
      keys.includes(k) ? null : set(k, v)
    )

  //looks through history starting at start_key to find axes of change
  const get_axes = (start_key, max_axes = 2) => {
    //clone keys so we can pop without ruining state
    const keys_ = [...keys]
      .slice(0, start_key ? keys.indexOf(start_key)+1 : undefined)
      .reverse()
    if (keys_.length < 2) return

    //the latest gen is the baseline to compare to
    let hist_ids = []
    const base = new Map(get(keys_[0]).workflow.nodes.map(n => [n.id, n]))
    const axes = new Map()

    //TODO the control flow here is kinda iffy lol
    let breakloop = false
    //TODO the way this works is efficient for the limited usecase of immediate past gens
    //there are situations where you would want to include gens in the discontinous past in the current grid
    for (const key of keys_) {
      get(key)?.workflow?.nodes?.forEach(n => {
        const {id: node_id, widgets_values: vals, mode, type} = n
        //TODO this isn't actually right, we need to handle bypassed nodes differently
        if (mode !== 0) return
        const ref = base.get(node_id).widgets_values
        //potential new axes found
        //we have to batch the axes because a single node can expand the number of axes past the limit
        const additional_axes = ref
          ?.map((r, widg_id) => {
            const v = vals[widg_id]
            //TODO deep comparing in JS sucks, idk if this is fast
            if (JSON.stringify(r) !== JSON.stringify(v)) {
              const axis_id = `${node_id}:${widg_id}`
              if (!axes.get(axis_id)) {
                return [axis_id, {node_id, widg_id, type}]
              }
            }
          })
          .filter(a => a)

        if (!additional_axes || !additional_axes.length) {
          //next loop if no axes found in the node
        } else if (axes.size + additional_axes.length <= max_axes) {
          //if we can fit additional axes add them to the map
          additional_axes.forEach(([axis_id, info]) => {
            axes.set(axis_id, info)
          })
        } else {
          //too many axes, break the loop
          breakloop = true
        }
      })
      if (breakloop) break
      hist_ids.push(key)
    }

    hist_ids.reverse()

    axes.forEach(axis => {
      axis.history = hist_ids.map(id => {
        const {node_id, widg_id} = axis
        return get(id).workflow.nodes.find(n => n.id == node_id).widgets_values[
          widg_id
        ]
      })
    })
    if (axes.size == 0) return
    return {axes, hist_ids}
  }

  const grid = start_key => {
    const axis_info = get_axes(start_key)
    console.log(axis_info, start_key)
    if (!axis_info || axis_info.axes.size !== 2) return
    const {hist_ids, axes} = axis_info
    const [x_axis, y_axis] = [...axes]
      .sort(([a], [b]) => b.split(":")[0] - a.split(":")[0])
      .map(a => a[1])
    //todo special case for 1d?
    const x_title = x_axis.type
    const y_title = y_axis.type
    const x_keys = [...new Set(x_axis.history)].sort()
    const y_keys = [...new Set(y_axis.history)].sort()
    const hist_zip = zip(hist_ids, [...x_axis.history], [...y_axis.history])
    const grid = y_keys.map(y =>
      x_keys.map(x => {
        //the reason we do a lookup like this here
        //is that there can potentially be multiple gens that are the same
        //this way everything still works, we just find the first one that matches
        return hist_zip.find(([, hx, hy]) => hx == x && hy == y)?.[0]
      })
    )

    return {
      width: x_keys.length,
      height: y_keys.length,
      x_keys,
      y_keys,
      x_title,
      y_title,
      grid,
    }
  }

  return {
    //set,
    get,
    axes: get_axes,
    grid,
    get keys() {
      return keys
    },
    get latest() {
      return latest()
    },
    get count() {
      return keys.length
    },
    push,
  }
}

const main = async ws => {
  const get_history = count =>
    fetch(`http://${URL}/history${count ? "?max_items=" + count : ""}`)
      .then(a => a.json())
      .catch({})

  const is_valid = value =>
    value.status.status_str === "success" && value.status.completed === true

  const cache = HistoryCache(await get_history())

  intent.focus = cache.latest.id

  ws.onmessage = async event => {
    let data, queue_remaining
    try {
      data = JSON.parse(event.data)
      queue_remaining = data.data.status.exec_info.queue_remaining
    } catch (e) {
      //console.warn(e)
      //if we don't have data and queue_remaining
      //it's not the right kind of message so we just return
      return
    }
    cache.push(await get_history(1))

    //TODO toggle this in the UI (stick_to_latest)
    intent.focus = cache.latest.id
  }

  const validate_intent = intent => {
    if (intent.focus) {
      const keys = cache.keys
      const gen = cache.get(intent.focus)
      const {images} = gen
      const size = images.size || 1
      intent.active_output = (intent.active_output + size) % size

      if (intent.move_history) {
        const index = keys.indexOf(intent.focus) + intent.move_history
        intent.focus = keys.at(index % keys.length)
        delete intent.move_history
      }

      if (intent.abs_history !== undefined) {
        intent.focus = keys.at(intent.abs_history % keys.length)
        delete intent.abs_history
      }
    }

    if (intent.view_mode === "grid") {
      const axes = cache.axes(intent.focus)
      if (axes && axes.axes.size == 2) {
        //console.log(grid)
      } else {
        intent.view_mode = "fullscreen"
      }
    }

    if (intent.grid_mode) intent.grid_mode = intent.grid_mode%2
  }

  const render_intent = async intent => {
    if (!intent) return
    const intent_hash = await hash_text(
      JSON.stringify(intent, (k, v) => {
        if (v instanceof Map || v instanceof Set) return [...v]
        return v
      })
    )
    if (intent_hash == prev_intent_hash) return
    validate_intent(intent)
    console.log(intent)
    //TODO incremental updates
    root.innerHTML = ""

    if (intent.focus && intent.view_mode === "fullscreen") {
      //TODO do something about this crazy deeply nested bs
      const cached_gen = cache.get(intent.focus)
      const image = [...cached_gen.images.values()][intent.active_output]
      if (image && image.images[0]) {
        const node_info = image.node
        console.log(node_info)
        const {url, div} = image.images[0]
        image_to_favicon(url)
        div.classList.add("imag")
        const name = node_info.title || node_info.type
        div.innerText = name + ":" + image.id
        root.appendChild(div)
      }
    } else if (intent.focus && intent.view_mode === "grid") {
      const grid_info = cache.grid(intent.focus)
      //const {width, height, x_keys, y_keys, x_title, y_title, grid} = grid_info
      const div = make_grid(grid_info, id => {
        const cached_gen = cache.get(id)
        const image = [...cached_gen.images.values()][intent.active_output]
        if (!image) return
        const node_info = image.node
        const {url, div} = image.images[0]
        return url
      })

      if (div) {
        if (intent.grid_mode == 1) div.classList.add('big-grid')
        root.appendChild(div)
      }
      /*
      div.gridElement.appendChild(div.styleElement)
        root.appendChild(div.gridElement)
        */
    }

    prev_intent_hash = intent_hash
  }

  const render_loop = async t => {
    await render_intent(intent)
    requestAnimationFrame(render_loop)
  }

  render_loop()
  //debug global
  Object.assign(window, {
    intent,
    cache,
    zip,
    compare_workflows,
  })
}

const ws = new ReconnectingWebSocket(
  `ws://${URL}/ws?clientId=${Math.random().toString(16).slice(-8)}`
)
main(ws)
