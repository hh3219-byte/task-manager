(function () {
      "use strict";
      const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
      const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const MAX_TASK_DESCRIPTION_LENGTH = 600;
      const STORAGE_KEY = "weekwise-planner-v1";
      const MAX_CALENDAR_TITLE_LENGTH = 48;
      const BASE_HOUR = 7;
      const END_HOUR = 22;
      const HOUR_HEIGHT = 56;
      const savedState = (function () {
        try {
          const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
          return parsed && typeof parsed === "object" ? parsed : {};
        } catch (error) { return {}; }
      }());
      const restoredTasks = Array.isArray(savedState.tasks) ? savedState.tasks.filter(function (task) {
        return task && Number.isInteger(task.id) && typeof task.title === "string" && task.title.trim();
      }).map(function (task) {
        return {
          id:task.id,
          title:task.title,
          details:typeof task.details === "string" ? task.details : task.title,
          estimateMinutes:Number.isFinite(Number(task.estimateMinutes)) ? Math.max(30, Math.round(Number(task.estimateMinutes) / 30) * 30) : 60,
          durationEdited:!!task.durationEdited,
          priorityOverride:["High", "Medium", "Low"].includes(task.priorityOverride) ? task.priorityOverride : null,
          dueDay:Number.isInteger(task.dueDay) && task.dueDay >= 0 && task.dueDay < 7 ? task.dueDay : null,
          remainingMinutes:0
        };
      }) : [];
      const restoredAvailability = Array.isArray(savedState.availability) ? savedState.availability.filter(function (block) {
        return block && Number.isInteger(block.day) && block.day >= 0 && block.day < 7 && Number.isFinite(block.start) && Number.isFinite(block.end) && block.start >= 0 && block.end <= 1440 && block.end > block.start;
      }).map(function (block) { return {day:block.day,start:block.start,end:block.end}; }) : [];
      const state = {
        weekOffset:Number.isInteger(savedState.weekOffset) ? savedState.weekOffset : 0,
        availability:restoredAvailability,
        tasks:restoredTasks,
        events:[],
        nextId:restoredTasks.reduce(function (max, task) { return Math.max(max, task.id); }, 0) + 1,
        noticeTimer:null,
        draft:typeof savedState.draft === "string" ? savedState.draft.slice(0, MAX_TASK_DESCRIPTION_LENGTH) : ""
      };
      const $ = function (id) { return document.getElementById(id); };
      const escapeHtml = function (value) {
        return String(value).replace(/[&<>"']/g, function (ch) { return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]; });
      };
      const persistPlannerState = function () {
        try {
          const input = $("taskInput");
          if (input) state.draft = input.value;
          localStorage.setItem(STORAGE_KEY, JSON.stringify({weekOffset:state.weekOffset,availability:state.availability,tasks:state.tasks,draft:state.draft}));
        } catch (error) { /* Keep the planner usable when browser storage is unavailable. */ }
      };
      const minutesFromTime = function (value) {
        const parts = value.split(":");
        return Number(parts[0]) * 60 + Number(parts[1]);
      };
      const formatTime = function (minutes) {
        const hour = Math.floor(minutes / 60);
        const minute = minutes % 60;
        const twelve = ((hour + 11) % 12) + 1;
        return twelve + (minute ? ":30" : "") + (hour >= 12 ? " PM" : " AM");
      };
      const formatDuration = function (minutes) {
        const hours = Math.floor(minutes / 60);
        const rest = minutes % 60;
        if (!hours) return rest + " min";
        if (!rest) return hours + " hr" + (hours === 1 ? "" : "s");
        return hours + " hr " + rest + " min";
      };
      const mondayFor = function (offset) {
        const date = new Date();
        date.setHours(0,0,0,0);
        date.setDate(date.getDate() - ((date.getDay() + 6) % 7) + (offset * 7));
        return date;
      };
      const dateStamp = function (date) {
        return date.getFullYear() + "-" + date.getMonth() + "-" + date.getDate();
      };
      const weekDateLabel = function (start) {
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        const sameMonth = start.getMonth() === end.getMonth();
        const first = start.toLocaleDateString("en-US", { month:"short", day:"numeric" });
        const last = end.toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" });
        return first + " – " + last;
      };
      const showToast = function (message, duration) {
        const toast = $("toast");
        toast.textContent = message;
        toast.classList.add("show");
        window.clearTimeout(state.noticeTimer);
        state.noticeTimer = window.setTimeout(function () { toast.classList.remove("show"); }, duration || 2600);
      };
      const cleanTask = function (value) {
        return String(value || "").replace(/\s+/g, " ")
          .replace(/^\s*(?:[•*\-–—]|\d+[.)])\s*/, "")
          .replace(/^(?:this week\s*,?\s*)?(?:i\s+(?:also\s+)?(?:need to|have to|should|want to|must|will|plan to|am going to|would like to|am using)|we\s+(?:also\s+)?(?:need to|have to|should|will)|(?:also\s+)?need to|don't forget to|please)\s+/i, "")
          .replace(/^(?:i|we)\s+(?:have|need|want)\s+(?:a|an|the)\s+(?:assignment|task|project|reading|report|essay)\s+(?:to|about|on)\s+/i, "")
          .replace(/^(?:then|after that|also)\s+/i, "")
          .replace(/^(?:the\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|one|two|three|four|five|six|seven|eight|nine|ten|another|other)(?:\s+(?:one|assignment|task))?\s+(?:is|:)\s*/i, "")
          .replace(/[.!?]+$/, "")
          .trim();
      };
      const numberValue = function (value) {
        const words = {one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
        return /^\d+$/.test(value) ? Number(value) : words[value.toLowerCase()] || null;
      };
      const normalizeTaskTitle = function (value) {
        let text = cleanTask(value).replace(/^(?:to|that)\s+/i, "").trim();
        const dueMatch = text.match(/\s*(?:\(?\s*)((?:due|deadline)\s+.+?)\s*\)?$/i);
        const dueSuffix = dueMatch ? " (" + dueMatch[1].trim() + ")" : "";
        if (dueMatch) text = text.slice(0, dueMatch.index).replace(/[,(]+$/, "").trim();
        const reading = text.match(/^(?:read\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+readings?\s*,?\s*(?:each\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+pages?(?:\s+each)?$/i);
        if (reading) {
          const count = numberValue(reading[1]);
          const pages = numberValue(reading[2]);
          if (count && pages) return "Read " + count + " readings (" + pages + " pages each)" + dueSuffix;
        }
        const usingTool = text.match(/^using\s+(.+?)\s+to\s+(build|create|make|develop|design|write|draft|research|study|review|finish|complete|prepare)\s+(.+)$/i);
        if (usingTool) {
          const tool = /^codex$/i.test(usingTool[1]) ? "Codex" : usingTool[1];
          const verb = usingTool[2].toLowerCase();
          return verb.charAt(0).toUpperCase() + verb.slice(1) + " " + usingTool[3] + " using " + tool + dueSuffix;
        }
        const gerund = text.match(/^(reading|studying|reviewing|writing|drafting|researching|building|creating|developing|designing|practicing|solving|preparing|finishing|completing|coding)\s+(.+)$/i);
        if (gerund) {
          const verbs = {reading:"Read",studying:"Study",reviewing:"Review",writing:"Write",drafting:"Draft",researching:"Research",building:"Build",creating:"Create",developing:"Develop",designing:"Design",practicing:"Practice",solving:"Solve",preparing:"Prepare",finishing:"Finish",completing:"Complete",coding:"Code"};
          text = verbs[gerund[1].toLowerCase()] + " " + gerund[2];
        }
        return text.charAt(0).toUpperCase() + text.slice(1) + dueSuffix;
      };
      const currentWeekdayIndex = function () {
        return state.weekOffset === 0 ? (new Date().getDay() + 6) % 7 : 0;
      };
      const findDueDay = function (text) {
        const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
        const named = text.match(/\b(?:due(?:\s+date)?(?:\s+is)?(?:\s+on)?|deadline(?:\s+is)?(?:\s+on)?|by|before|submit\s+by|turn\s+in(?:\s+by)?)\s+(?:this\s+|next\s+|coming\s+)?(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)\b/i);
        if (named) {
          const day = named[1].toLowerCase();
          return days.findIndex(function (name) { return name.startsWith(day); });
        }
        const relative = text.match(/\b(?:due\s+)?(today|tonight|tomorrow|in\s+(\d+)\s+days?)\b/i);
        if (!relative) return null;
        const offset = /today|tonight/i.test(relative[1]) ? 0 : /tomorrow/i.test(relative[1]) ? 1 : Number(relative[2]);
        return (currentWeekdayIndex() + offset) % 7;
      };
      const estimateTask = function (title) {
        const text = title.toLowerCase();
        let minutes = 60;
        if (/\b(email|message|print|schedule|organize|appointment|meeting|flashcards?)\b/.test(text)) minutes = 30;
        else if (/\b(lab report|research paper|term paper|essay|final project|project|thesis|portfolio)\b/.test(text)) minutes = 180;
        else if (/\b(build|create|develop|design|code|program)\b.{0,45}\b(website|web site|web app|software|application)\b/.test(text)) minutes = 180;
        else if (/\b(report|lab|draft|presentation|essay)\b/.test(text)) minutes = 120;
        else if (/\b(read|reading|annotate|notes?)\b/.test(text)) {
          const reading = text.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:(?:[a-z][a-z'-]*)\s+){0,2}readings?\b[\s\S]{0,35}?\b(?:each\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*pages?\s+each\b/i);
          const pages = text.match(/\b(\d+)\s*pages?\b/);
          const chapters = text.match(/\b(\d+)\s*chapters?\b/);
          const pageCount = reading ? numberValue(reading[1]) * numberValue(reading[2]) : pages ? Number(pages[1]) : null;
          minutes = pageCount ? Math.min(360, Math.max(60, Math.ceil(pageCount * 2 / 30) * 30)) : chapters ? Math.min(180, Math.max(60, Number(chapters[1]) * 60)) : 60;
        } else if (/\b(problem sets?|homework|assignments?|practice problems?|worksheets?)\b/.test(text)) minutes = 90;
        else if (/\b(exams?|midterms?|finals?|quiz(?:zes)?|tests?|presentations?)\b/.test(text)) minutes = /\b(study|review|prepare|practice)\b/.test(text) ? 90 : 60;
        else if (/\b(study|review|prepare|practice|research|write|revise|edit|solve|memorize|summarize)\b/.test(text)) minutes = 60;
        return { minutes:minutes, dueDay:findDueDay(text) };
      };
      const shortenCalendarTitle = function (value) {
        const title = String(value || "").replace(/\s+/g, " ").trim();
        if (title.length <= MAX_CALENDAR_TITLE_LENGTH) return title;
        const limit = MAX_CALENDAR_TITLE_LENGTH - 1;
        const clipped = title.slice(0, limit).replace(/\s+\S*$/, "").trim();
        return (clipped || title.slice(0, limit).trim()) + "…";
      };
      const summarizeTask = function (description, dueDay) {
        let text = cleanTask(description);
        const usingTool = text.match(/^(?:i\s+)?(?:am\s+using|use|using)\s+(.+?)\s+to\s+(build|create|make|develop|design|write|draft|research|study|review|finish|complete|prepare)\s+(.+)$/i);
        if (usingTool) {
          const tool = usingTool[1].replace(/\s+/g, " ").trim();
          const verb = usingTool[2].toLowerCase();
          text = verb.charAt(0).toUpperCase() + verb.slice(1) + " " + usingTool[3] + " using " + tool;
        }
        let title = normalizeTaskTitle(text).replace(/\s*\((?:due|deadline)\s+[^)]+\)\s*$/i, "").trim();
        if (dueDay !== null && dueDay !== undefined && !/\bdue\b/i.test(title)) title += " · due " + DAY_SHORT[dueDay];
        title = title.charAt(0).toUpperCase() + title.slice(1);
        return shortenCalendarTitle(title);
      };
      const makeTask = function (raw) {
        const details = String(raw || "").replace(/\s+/g, " ").trim();
        const estimate = estimateTask(details);
        return {
          id:state.nextId++,
          title:summarizeTask(details, estimate.dueDay),
          details:details,
          estimateMinutes:estimate.minutes,
          durationEdited:false,
          priorityOverride:null,
          dueDay:estimate.dueDay,
          remainingMinutes:0
        };
      };
      const daysUntilDue = function (task) {
        if (task.dueDay === null || task.dueDay === undefined) return null;
        const difference = task.dueDay - currentWeekdayIndex();
        return difference < 0 ? difference + 7 : difference;
      };
      const priorityScore = function (task) {
        const text = ((task.details || "") + " " + task.title).toLowerCase();
        let score = 50;
        const days = daysUntilDue(task);
        if (days !== null) score += days === 0 ? 42 : days <= 1 ? 38 : days <= 3 ? 30 : days <= 5 ? 22 : 12;
        if (/\b(urgent|asap|as soon as possible|first thing|top priority|high priority|most important|professor emphasized|instructor emphasized)\b/.test(text)) score += 22;
        if (/\b(exams?|midterms?|finals?|quiz(?:zes)?|tests?)\b/.test(text)) score += 20;
        if (/\b(due|deadline|submit|submission|turn in|hand in|presentation)\b/.test(text)) score += 10;
        if (task.estimateMinutes >= 120) score += 8;
        else if (task.estimateMinutes <= 30) score += 2;
        if (/\b(optional|extra credit|if i have time|when i can)\b/.test(text)) score -= 35;
        if (task.priorityOverride === "High") score = Math.max(score, 85);
        else if (task.priorityOverride === "Medium") score = Math.max(50, Math.min(score, 79));
        else if (task.priorityOverride === "Low") score = Math.min(score, 49);
        return Math.max(0, Math.min(100, score));
      };
      const priorityLabel = function (task) {
        const score = priorityScore(task);
        return score >= 80 ? "High" : score >= 50 ? "Medium" : "Low";
      };
      const effectivePriority = function (task) {
        return task.priorityOverride || priorityLabel(task);
      };
      const priorityReason = function (task) {
        const text = ((task.details || "") + " " + task.title).toLowerCase();
        const reasons = [];
        const days = daysUntilDue(task);
        if (days !== null) reasons.push(days === 0 ? "Due today" : "Due " + DAY_SHORT[task.dueDay]);
        if (/\b(urgent|asap|as soon as possible|first thing|top priority|high priority|most important)\b/.test(text)) reasons.push("Marked urgent");
        if (/\b(exams?|midterms?|finals?|quiz(?:zes)?|tests?)\b/.test(text)) reasons.push("Assessment prep");
        else if (/\b(due|deadline|submit|submission|turn in|hand in|presentation)\b/.test(text)) reasons.push("Deadline task");
        if (task.estimateMinutes >= 120) reasons.push("Start early · " + formatDuration(task.estimateMinutes));
        if (/\b(optional|extra credit|if i have time|when i can)\b/.test(text)) reasons.push("Optional");
        if (task.priorityOverride) reasons.push("Your " + task.priorityOverride.toLowerCase() + " setting");
        return reasons.slice(0, 2).join(" · ") || "No deadline found · balanced";
      };
      const rankedTasks = function (tasks) {
        return tasks.slice().sort(function (a,b) {
          const scoreDiff = priorityScore(b) - priorityScore(a);
          if (scoreDiff) return scoreDiff;
          const dayA = daysUntilDue(a);
          const dayB = daysUntilDue(b);
          return (dayA === null ? 8 : dayA) - (dayB === null ? 8 : dayB) || a.id - b.id;
        });
      };
      const buildSlots = function () {
        const weekStart = mondayFor(state.weekOffset);
        const now = new Date();
        const today = new Date(now);
        today.setHours(0,0,0,0);
        const currentMinute = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 30) * 30;
        const slots = [];
        state.availability.forEach(function (block) {
          const date = new Date(weekStart);
          date.setDate(date.getDate() + block.day);
          let start = Math.max(block.start, BASE_HOUR * 60);
          const end = Math.min(block.end, END_HOUR * 60);
          if (date < today) return;
          if (dateStamp(date) === dateStamp(today)) start = Math.max(start, currentMinute);
          if (end - start >= 30) slots.push({ day:block.day, date:date, start:start, end:end });
        });
        return slots.sort(function (a,b) { return a.day - b.day || a.start - b.start; });
      };
      const scheduleTasks = function () {
        const slots = buildSlots();
        const sorted = rankedTasks(state.tasks);
        state.events = [];
        const remaining = {};
        state.tasks.forEach(function (task) { remaining[task.id] = task.estimateMinutes; });
        sorted.forEach(function (task, taskIndex) {
          let todo = task.estimateMinutes;
          for (let i = 0; i < slots.length && todo > 0; i += 1) {
            const slot = slots[i];
            const capacity = slot.end - slot.start;
            if (capacity < 30) continue;
            let part = Math.min(60, todo, capacity);
            part = Math.floor(part / 30) * 30;
            if (!part) continue;
            state.events.push({ taskId:task.id, rank:taskIndex + 1, day:slot.day, start:slot.start, end:slot.start + part, title:task.title, details:task.details, priority:effectivePriority(task) });
            slot.start += part;
            todo -= part;
          }
          remaining[task.id] = todo;
        });
        state.tasks.forEach(function (task) { task.remainingMinutes = remaining[task.id] || 0; });
        renderAll();
      };
      const renderAvailability = function () {
        const target = $("availabilityList");
        if (!state.availability.length) {
          target.innerHTML = '<div class="empty-avail">No open blocks yet. Add a time above to give your tasks somewhere to go.</div>';
          return;
        }
        target.innerHTML = state.availability.map(function (block, index) {
          return '<div class="avail-row"><span class="avail-dot"></span><span class="avail-label">' + DAY_NAMES[block.day] + ' · ' + formatTime(block.start) + '–' + formatTime(block.end) + '</span><button class="remove-block" type="button" data-remove-block="' + index + '" aria-label="Remove ' + DAY_NAMES[block.day] + ' availability">×</button></div>';
        }).join("");
        target.querySelectorAll("[data-remove-block]").forEach(function (button) {
          button.addEventListener("click", function () {
            state.availability.splice(Number(button.dataset.removeBlock), 1);
            if (state.tasks.length) scheduleTasks(); else renderAll();
          });
        });
      };
      const renderTaskList = function () {
        $("taskCountLabel").textContent = state.tasks.length + (state.tasks.length === 1 ? " task" : " tasks");
        const list = $("taskList");
        if (!state.tasks.length) {
          list.innerHTML = '<div class="empty-tasks">Add tasks one at a time. Your short calendar labels and original notes will appear here.</div>';
          return;
        }
        const ordered = rankedTasks(state.tasks);
        list.innerHTML = ordered.map(function (task, index) {
          const priority = effectivePriority(task);
          const mark = priority === "High" ? "high" : priority === "Low" ? "low" : "";
          const autoLabel = "Auto · " + priority;
          return '<div class="task-row"><span class="rank-badge" aria-label="Priority rank ' + (index + 1) + '">' + (index + 1) + '</span><div class="task-copy"><textarea class="task-title-input" rows="1" maxlength="' + MAX_CALENDAR_TITLE_LENGTH + '" data-title-task="' + task.id + '" aria-label="Edit calendar summary: ' + escapeHtml(task.title) + '" title="Edit the short calendar label">' + escapeHtml(task.title) + '</textarea><details class="task-source"><summary>Original note</summary><p>' + escapeHtml(task.details || task.title) + '</p></details><div class="task-reason">' + escapeHtml(priorityReason(task)) + '</div></div><div class="duration-wrap"><input class="duration-input" type="number" min="30" step="30" value="' + task.estimateMinutes + '" data-duration-task="' + task.id + '" aria-label="Estimated minutes for ' + escapeHtml(task.title) + '"><span>min</span></div><div class="task-controls"><span class="priority-mark ' + mark + '" aria-hidden="true"></span><span class="priority-level ' + mark + '">' + priority + '</span><select class="priority-select" aria-label="Priority for ' + escapeHtml(task.title) + '" data-priority-task="' + task.id + '"><option value="" ' + (task.priorityOverride === null ? "selected" : "") + '>' + autoLabel + '</option><option value="High" ' + (task.priorityOverride === "High" ? "selected" : "") + '>High · move up</option><option value="Medium" ' + (task.priorityOverride === "Medium" ? "selected" : "") + '>Medium</option><option value="Low" ' + (task.priorityOverride === "Low" ? "selected" : "") + '>Low · move down</option></select><button class="remove-task" type="button" data-remove-task="' + task.id + '" aria-label="Remove task: ' + escapeHtml(task.title) + '" title="Remove task">×</button></div></div>';
        }).join("");
        list.querySelectorAll("[data-title-task]").forEach(function (input) {
          const fit = function () {
            input.style.height = "auto";
            input.style.height = Math.max(input.scrollHeight, 32) + "px";
          };
          fit();
          input.addEventListener("input", fit);
          input.addEventListener("change", function () {
            const task = state.tasks.find(function (item) { return item.id === Number(input.dataset.titleTask); });
            const title = shortenCalendarTitle(cleanTask(input.value));
            if (!task) return;
            if (!title) {
              showToast("Keep a short task description so it can be scheduled.");
              renderTaskList();
              return;
            }
            task.title = title;
            scheduleTasks();
          });
        });
        list.querySelectorAll("[data-duration-task]").forEach(function (input) {
          input.addEventListener("change", function () {
            const value = Math.max(30, Math.round(Number(input.value || 30) / 30) * 30);
            const task = state.tasks.find(function (item) { return item.id === Number(input.dataset.durationTask); });
            if (!task) return;
            task.estimateMinutes = value;
            task.durationEdited = true;
            scheduleTasks();
          });
        });
        list.querySelectorAll("[data-priority-task]").forEach(function (select) {
          select.addEventListener("change", function () {
            const task = state.tasks.find(function (item) { return item.id === Number(select.dataset.priorityTask); });
            if (!task) return;
            task.priorityOverride = select.value || null;
            scheduleTasks();
          });
        });
        list.querySelectorAll("[data-remove-task]").forEach(function (button) {
          button.addEventListener("click", function () {
            state.tasks = state.tasks.filter(function (task) { return task.id !== Number(button.dataset.removeTask); });
            if (state.tasks.length) scheduleTasks(); else { state.events = []; renderAll(); }
            showToast("Task removed.");
          });
        });
      };
      const renderCalendar = function () {
        const weekStart = mondayFor(state.weekOffset);
        $("weekLabel").textContent = weekDateLabel(weekStart);
        const today = new Date();
        today.setHours(0,0,0,0);
        const dates = DAY_NAMES.map(function (_, index) {
          const date = new Date(weekStart);
          date.setDate(date.getDate() + index);
          return date;
        });
        $("calendarHead").innerHTML = dates.map(function (date, index) {
          const isToday = dateStamp(date) === dateStamp(today);
          return '<div class="day-heading ' + (isToday ? "today" : "") + '"><div class="day-name">' + DAY_SHORT[index] + '</div><div class="day-date">' + date.getDate() + '</div></div>';
        }).join("");
        $("timeRail").innerHTML = Array.from({length:15}, function (_, index) {
          const hour = BASE_HOUR + index;
          const label = (hour % 12 || 12) + (hour >= 12 ? " PM" : " AM");
          return '<div class="time-label" style="top:' + (index * HOUR_HEIGHT) + 'px">' + label + '</div>';
        }).join("");
        const blocksByDay = DAY_NAMES.map(function () { return []; });
        state.availability.forEach(function (block) { blocksByDay[block.day].push(block); });
        const eventsByDay = DAY_NAMES.map(function () { return []; });
        state.events.forEach(function (event) { eventsByDay[event.day].push(event); });
        const anyEvents = state.events.length > 0;
        $("dayTracks").innerHTML = DAY_NAMES.map(function (_, day) {
          const isToday = dateStamp(dates[day]) === dateStamp(today);
          const bands = blocksByDay[day].map(function (block) {
            const top = (block.start - BASE_HOUR * 60) / 60 * HOUR_HEIGHT;
            const height = (block.end - block.start) / 60 * HOUR_HEIGHT;
            return '<div class="avail-band" style="top:' + top + 'px;height:' + height + 'px" title="Available ' + formatTime(block.start) + ' to ' + formatTime(block.end) + '"></div>';
          }).join("");
          const events = eventsByDay[day].map(function (event) {
            const top = (event.start - BASE_HOUR * 60) / 60 * HOUR_HEIGHT;
            const height = (event.end - event.start) / 60 * HOUR_HEIGHT;
            const priority = event.priority === "High" ? "high" : event.priority === "Low" ? "low" : "";
            const duration = formatDuration(event.end - event.start);
            const compact = event.end - event.start <= 30 ? " compact" : "";
            const fullTask = event.details || event.title;
            return '<article class="event ' + priority + compact + '" style="top:' + top + 'px;height:' + height + 'px" aria-label="Priority ' + event.rank + '. ' + escapeHtml(event.title) + '. Original task: ' + escapeHtml(fullTask) + '. ' + formatTime(event.start) + ' to ' + formatTime(event.end) + '" title="Priority ' + event.rank + ' · ' + escapeHtml(event.title) + ' · Original task: ' + escapeHtml(fullTask) + ' · ' + formatTime(event.start) + '–' + formatTime(event.end) + '"><div class="event-title"><span class="event-rank">' + event.rank + '</span><span class="event-description">' + escapeHtml(event.title) + '</span></div><div class="event-time">' + formatTime(event.start) + ' · ' + duration + '</div></article>';
          }).join("");
          return '<div class="day-track ' + (isToday ? "today" : "") + '">' + bands + events + '</div>';
        }).join("");
        if (!anyEvents) {
          const haveTasks = state.tasks.length > 0;
          const haveTime = state.availability.length > 0;
          const message = haveTasks ? (haveTime ? "No sessions fit into the open time left this week." : "Add a few open blocks and your tasks will appear here.") : "Start with your tasks and open hours. Your plan will take shape here.";
          $("dayTracks").insertAdjacentHTML("beforeend", '<div class="calendar-empty">' + message + '</div>');
        }
      };
      const renderCarryOver = function () {
        const carry = rankedTasks(state.tasks.filter(function (task) { return task.remainingMinutes > 0; }));
        $("carryEmpty").hidden = carry.length > 0;
        $("planNextWeek").hidden = carry.length === 0;
        $("carryItems").innerHTML = carry.map(function (task) {
          return '<div class="carry-item"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 12.5 10 15l7-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/></svg><span class="carry-name">' + escapeHtml(task.title) + '</span><span class="carry-time">' + formatDuration(task.remainingMinutes) + ' left</span></div>';
        }).join("");
        const carrySubtitle = carry.length ? carry.length + (carry.length === 1 ? " task needs" : " tasks need") + " another week." : "Anything that doesn't fit stays on your list.";
        document.querySelector(".carry-subtitle").textContent = carrySubtitle;
      };
      const renderSummary = function () {
        const total = state.tasks.reduce(function (sum, task) { return sum + task.estimateMinutes; }, 0);
        const scheduled = state.events.reduce(function (sum, event) { return sum + event.end - event.start; }, 0);
        $("summaryTasks").textContent = String(state.tasks.length);
        $("summaryHours").textContent = total ? (total % 60 ? (total / 60).toFixed(1).replace(/\.0$/, "") : String(total / 60)) + "h" : "0h";
        $("summaryScheduled").textContent = total ? Math.round(scheduled / total * 100) + "%" : "0%";
      };
      const renderAll = function () {
        renderAvailability();
        renderTaskList();
        renderCalendar();
        renderCarryOver();
        renderSummary();
        persistPlannerState();
      };

      const taskInput = $("taskInput");
      const taskCharCount = $("taskCharCount");
      const updateTaskCharCount = function () {
        const length = taskInput.value.length;
        taskCharCount.textContent = length + " / " + MAX_TASK_DESCRIPTION_LENGTH;
        taskCharCount.classList.toggle("near-limit", length >= MAX_TASK_DESCRIPTION_LENGTH - 80);
      };
      const updateTaskSummary = function () {
        const description = taskInput.value.trim();
        if (!description) {
          $("taskSummaryText").textContent = "Your short task label will appear here.";
          return;
        }
        const estimate = estimateTask(description);
        $("taskSummaryText").textContent = summarizeTask(description, estimate.dueDay);
      };
      taskInput.value = state.draft;
      taskInput.addEventListener("input", function () {
        updateTaskCharCount();
        updateTaskSummary();
        state.draft = taskInput.value;
        persistPlannerState();
      });
      updateTaskCharCount();
      updateTaskSummary();
      $("taskForm").addEventListener("submit", function (event) {
        event.preventDefault();
        const description = taskInput.value.trim();
        if (!description) {
          showToast("Write one task before adding it.");
          taskInput.focus();
          return;
        }
        if (description.length > MAX_TASK_DESCRIPTION_LENGTH) {
          showToast("Keep the task description under " + MAX_TASK_DESCRIPTION_LENGTH + " characters.");
          taskInput.focus();
          return;
        }
        const task = makeTask(description);
        state.tasks.push(task);
        taskInput.value = "";
        state.draft = "";
        updateTaskCharCount();
        updateTaskSummary();
        scheduleTasks();
        showToast("Added: “" + task.title + "”. Add another task or edit its calendar label.", 4200);
      });
      $("availabilityForm").addEventListener("submit", function (event) {
        event.preventDefault();
        const day = Number($("availDay").value);
        const start = minutesFromTime($("availStart").value);
        const end = minutesFromTime($("availEnd").value);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
          showToast("Choose an end time after the start time.");
          return;
        }
        const ranges = state.availability.filter(function (block) { return block.day === day; }).concat([{day:day,start:start,end:end}]).sort(function (a,b) { return a.start - b.start; });
        const merged = [];
        ranges.forEach(function (range) {
          const last = merged[merged.length - 1];
          if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
          else merged.push({day:day,start:range.start,end:range.end});
        });
        state.availability = state.availability.filter(function (block) { return block.day !== day; }).concat(merged).sort(function (a,b) { return a.day - b.day || a.start - b.start; });
        if (state.tasks.length) scheduleTasks(); else renderAll();
        showToast("Open time added.");
      });
      $("previousWeek").addEventListener("click", function () {
        state.weekOffset -= 1;
        if (state.tasks.length) scheduleTasks(); else renderAll();
      });
      $("nextWeek").addEventListener("click", function () {
        state.weekOffset += 1;
        if (state.tasks.length) scheduleTasks(); else renderAll();
      });
      $("thisWeek").addEventListener("click", function () {
        state.weekOffset = 0;
        if (state.tasks.length) scheduleTasks(); else renderAll();
      });
      $("planNextWeek").addEventListener("click", function () {
        const carry = state.tasks.filter(function (task) { return task.remainingMinutes > 0; }).map(function (task) {
          return Object.assign({}, task, { estimateMinutes:task.remainingMinutes, remainingMinutes:0 });
        });
        if (!carry.length) return;
        state.tasks = carry;
        state.weekOffset += 1;
        scheduleTasks();
        document.querySelector(".calendar-card").scrollIntoView({behavior:"smooth",block:"start"});
        showToast("Your unfinished tasks are ready to plan next week.");
      });
      if (state.tasks.length) scheduleTasks(); else renderAll();
    }());
