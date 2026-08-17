export namespace Group {
    export interface Info {
        id: string
        name: string
    }

    /** QQ OpenAPI 群基本信息响应 */
    export interface ApiInfo {
        group_openid: string
        group_name: string
        group_finger_memo: string
        group_class_text: string
        group_tags: string[]
        group_member_num: number
    }

    /** QQ OpenAPI 机器人群内状态响应 */
    export interface BotState {
        member_openid: string
        /** 入群时间（RFC3339 格式） */
        joined_at: string
        allow_proactive_msg: boolean
        recv_msg_setting: 'all' | 'only_mention' | 'mention_and_context'
        member_role: 'member' | 'owner' | 'admin'
    }

    /** 群成员禁言操作类型 */
    export type MemberMuteOperation = 'add' | 'update' | 'del'

    /** 设置群成员禁言请求项 */
    export interface SetMemberMuteState {
        op: MemberMuteOperation
        member_openid: string
        /** 禁言到期时间（RFC3339 格式）；解除禁言时可传空字符串 */
        mute_expire_at?: string
    }

    /** 当前处于禁言状态的群成员 */
    export interface MemberMuteState {
        member_openid: string
        mute_expire_at: string
        username: string
        union_openid: string
    }

    export interface MuteScheduleRule {
        task_id: string
        start_at: string
        end_at: string
        enabled: boolean
    }

    export interface MuteRecurringRule {
        task_id: string
        weekdays: number[]
        start_time: string
        end_time: string
        enabled: boolean
    }

    export interface GlobalMuteRule {
        mode: 'none' | 'always' | 'schedule'
        schedule_rules: MuteScheduleRule[]
        recurring_rules: MuteRecurringRule[]
    }

    /** 查询群禁言状态响应 */
    export interface RestrictChatSetting {
        global_rule: GlobalMuteRule
        members: MemberMuteState[]
    }
}
