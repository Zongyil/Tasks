/**
 * Web Worker for Data Processing, To-Do Text Parsing, TXT Export/Import Serialization,
 * and Image Luminance Analysis.
 * Keeps UI thread completely smooth during heavy data manipulation.
 */

function getTargetDateStr(keyword) {
  const d = new Date();
  if (keyword === '明天') d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

self.onmessage = function (e) {
  const { taskId, action, payload } = e.data;

  try {
    let result = null;

    switch (action) {
      case 'parse_todo': {
        const { text, existingHubData, existingFlowData, existingMapping } = payload;
        if (!text || !text.trim()) {
          result = { error: "请先粘贴 To Do 列表文本!" };
          break;
        }

        const lines = text.split('\n').filter(l => l.trim() !== '');
        if (lines.length === 0) {
          result = { hubData: existingHubData, flowData: existingFlowData, addedHub: 0, addedFlow: 0 };
          break;
        }

        const listCategory = lines[0].trim();
        let isCompletedSection = false;
        let parentTaskName = "";

        let hubData = Array.isArray(existingHubData) ? [...existingHubData] : [];
        let flowData = (existingFlowData && typeof existingFlowData === 'object') ? { ...existingFlowData } : {};
        let mapping = (existingMapping && typeof existingMapping === 'object') ? { ...existingMapping } : {};
        
        let addedHub = 0;
        let addedFlow = 0;

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          if (line.trim() === '已完成') {
            isCompletedSection = true;
            continue;
          }

          const isPending = line.includes('⬜');
          const isDone = line.includes('✅');

          if (!isPending && !isDone) continue;

          const isSubtask = line.startsWith(' ') || line.startsWith('\t') || line.startsWith('  ');
          let taskName = line.replace(/⬜|✅/g, '').trim();
          let priority = 'Medium';
          let deadline = '无截止日期';

          if (taskName.includes('★')) {
            priority = 'High';
            taskName = taskName.replace('★', '').trim();
          }

          const dateMatch = taskName.match(/- 截止 (今天|明天)/);
          if (dateMatch) {
            deadline = getTargetDateStr(dateMatch[1]);
            taskName = taskName.replace(dateMatch[0], '').trim();
          }

          if (isSubtask && parentTaskName) {
            taskName = `${parentTaskName} - ${taskName}`;
          } else {
            parentTaskName = taskName;
          }

          const taskIdStr = 'todo-' + Date.now() + '-' + i + '-' + Math.floor(Math.random() * 1000);
          const taskObj = {
            id: taskIdStr,
            name: taskName,
            subject: [listCategory],
            priority: priority,
            remark: "从 To Do 导入",
            start: "",
            end: "",
            isCompleted: isCompletedSection || isDone
          };

          if (taskObj.isCompleted) {
            const todayStr = getTargetDateStr('今天');
            if (!flowData[todayStr]) flowData[todayStr] = [];
            flowData[todayStr].push({
              id: taskObj.id,
              name: taskObj.name,
              category: taskObj.subject,
              duration: 25,
              date: todayStr,
              remark: taskObj.remark,
              createdAt: Date.now()
            });
            addedFlow++;
          } else {
            hubData.push(taskObj);
            addedHub++;
            mapping[taskObj.id] = ['default'];
          }
        }

        result = { hubData, flowData, mapping, addedHub, addedFlow };
        break;
      }

      case 'export_txt': {
        const { account, taskflow, taskhub, tasktimer, wallpaper } = payload;
        const exportPayload = {
          account: account || "{}",
          taskflow: taskflow || "{}",
          taskhub: taskhub || "[]",
          tasktimer: tasktimer || "[]",
          wallpaper: wallpaper || ""
        };
        const jsonString = JSON.stringify(exportPayload, null, 2);
        result = { jsonString };
        break;
      }

      case 'import_txt': {
        const { content } = payload;
        const parsed = JSON.parse(content);
        result = {
          account: typeof parsed.account === 'object' ? JSON.stringify(parsed.account) : parsed.account,
          taskflow: typeof parsed.taskflow === 'object' ? JSON.stringify(parsed.taskflow) : parsed.taskflow,
          taskhub: typeof parsed.taskhub === 'object' ? JSON.stringify(parsed.taskhub) : parsed.taskhub,
          tasktimer: typeof parsed.tasktimer === 'object' ? JSON.stringify(parsed.tasktimer) : parsed.tasktimer,
          wallpaper: typeof parsed.wallpaper === 'object' ? JSON.stringify(parsed.wallpaper) : parsed.wallpaper
        };
        break;
      }

      case 'calc_luminance': {
        // Compute average luminance from RGBA pixel array
        const { pixels } = payload;
        if (!pixels || pixels.length === 0) {
          result = { isDark: false, luminance: 255 };
          break;
        }
        let totalLuminance = 0;
        const count = pixels.length / 4;
        for (let i = 0; i < pixels.length; i += 4) {
          const r = pixels[i];
          const g = pixels[i + 1];
          const b = pixels[i + 2];
          // Standard ITU-R BT.601 relative luminance formula
          totalLuminance += (0.299 * r + 0.587 * g + 0.114 * b);
        }
        const avgLuminance = totalLuminance / count;
        result = { isDark: avgLuminance < 128, luminance: avgLuminance };
        break;
      }

      default:
        throw new Error(`Unknown data worker action: ${action}`);
    }

    self.postMessage({ taskId, success: true, result });
  } catch (err) {
    self.postMessage({ taskId, success: false, error: err.message || String(err) });
  }
};
