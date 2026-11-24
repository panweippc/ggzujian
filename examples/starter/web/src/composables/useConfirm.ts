/**
 * 全局确认弹窗 —— 高危操作统一二次密码验证
 * 后端 verifyAdminPassword 校验当前登录密码；这里弹窗收集密码并随业务请求提交。
 *
 * 用法：
 *   const { confirmDanger } = useConfirm();
 *   const pwd = await confirmDanger('确定删除该用户吗？');
 *   if (!pwd) return;                       // 用户取消
 *   await api.delete(`/xxx?adminPassword=${pwd}`)  // 或放 body
 */
import { ElMessageBox } from 'element-plus';

/**
 * @param message 确认文案
 * @param title 标题
 * @returns 用户输入的密码；取消返回 null
 */
export async function confirmDanger(message: string, title = '高危操作确认'): Promise<string | null> {
  try {
    const { value } = await ElMessageBox.prompt(
      `${message}\n\n请输入您的当前登录密码以确认：`,
      title,
      {
        confirmButtonText: '确认',
        cancelButtonText: '取消',
        inputType: 'password',
        inputPlaceholder: '当前登录密码',
        inputValidator: (v: string) => (v && v.trim() ? true : '请输入当前登录密码'),
        type: 'warning',
        customClass: 'confirm-danger-box',
      }
    );
    return value;
  } catch {
    return null; // 取消或关闭
  }
}

/** 普通确认（不需密码） */
export async function confirmAction(message: string, title = '提示'): Promise<boolean> {
  try {
    await ElMessageBox.confirm(message, title, {
      confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning'
    });
    return true;
  } catch { return false; }
}

export function useConfirm() {
  return { confirmDanger, confirmAction };
}
