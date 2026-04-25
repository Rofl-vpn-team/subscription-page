import { ActionIcon, Button } from '@mantine/core'

export default {
    ActionIcon: ActionIcon.extend({
        defaultProps: {
            color: 'violet',
            radius: 'md',
            variant: 'outline'
        }
    }),
    Button: Button.extend({
        defaultProps: {
            color: 'violet',
            radius: 'md',
            variant: 'outline'
        }
    })
}
